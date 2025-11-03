import { type DecodeEventLogReturnType } from 'viem';
import { createInsertSchema } from 'drizzle-zod';

import type { DripsAbi } from '../../chains/abis/abiTypes.js';
import { logger } from '../../logger.js';
import { isOrcidAccount, isProject } from '../../utils/repoDriverAccountUtils.js';
import { isNftDriverId } from '../../utils/ntfDriverAccountIdUtils.js';
import { isImmutableSplitsDriverId } from '../../utils/immutableSplitsDriverUtils.js';
import { toEventPointer } from '../../repositories/types.js';
import { unreachable } from '../../utils/unreachable.js';
import type { EventHandler, HandlerEvent } from '../EventHandler.js';
import { validateSplits } from '../../utils/validateSplits.js';
import { upsert, findOne, update } from '../../db/db.js';
import { splitsSetEvents } from '../../db/schema.js';
import {
  projectSchema,
  type Project,
  dripListSchema,
  type DripList,
  ecosystemMainAccountSchema,
  type EcosystemMainAccount,
  subListSchema,
  type SubList,
  linkedIdentitySchema,
  type LinkedIdentity,
} from '../../db/schemas.js';
import { calculateProjectVerificationStatus } from '../../utils/calculateProjectVerificationStatus.js';

import { isSplittingToOwnerOnly } from './isSplittingToOwnerOnly.js';

const splitsSetEventSchema = createInsertSchema(splitsSetEvents).omit({
  created_at: true,
  updated_at: true,
});

type SplitsSetEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<DripsAbi, 'SplitsSet'>['args'];
};

export const splitsSetHandler: EventHandler<SplitsSetEvent> = async (event, ctx) => {
  const { accountId, receiversHash: splitsHashFromEvent } = event.args;
  const { client, schema, splitsRepo, contracts } = ctx;

  const splitsSetEvent = splitsSetEventSchema.parse({
    account_id: accountId.toString(),
    receivers_hash: splitsHashFromEvent,
    log_index: event.logIndex,
    block_number: event.blockNumber,
    block_timestamp: event.blockTimestamp,
    transaction_hash: event.txHash,
  });

  await upsert({
    client,
    table: `${schema}.splits_set_events`,
    data: splitsSetEvent,
    conflictColumns: ['transaction_hash', 'log_index'],
  });

  // "Unsafe" calls are acceptable here for "valid NOW" semantics:
  // - Non-deterministic: same historic event may produce different results if reprocessed later
  // - Eventual consistency: after catch-up, only the latest SplitsSet has is_valid=true
  // This trade-off is intentional to validate current on-chain state, not historic state.

  const accountIdStr = accountId.toString();
  const eventPointer = toEventPointer(event);

  if (isOrcidAccount(accountIdStr)) {
    const linkedIdentity = await findOne<LinkedIdentity>({
      client,
      table: `${schema}.linked_identities`,
      where: { account_id: accountIdStr },
      schema: linkedIdentitySchema,
    });

    if (!linkedIdentity || !linkedIdentity.owner_account_id) {
      throw new Error(
        `ORCID with account ID ${accountIdStr} not found or has no owner while processing splits but was expected to exist`,
      );
    }

    const onChainCurrentSplitsHash = await contracts.drips.read.splitsHash([accountId]);
    const areSplitsValid =
      onChainCurrentSplitsHash === splitsHashFromEvent &&
      (await isSplittingToOwnerOnly(
        linkedIdentity.owner_account_id,
        onChainCurrentSplitsHash,
        contracts.drips,
      ));

    const result = await update<LinkedIdentity>({
      client,
      table: `${schema}.linked_identities`,
      data: {
        account_id: accountIdStr,
        are_splits_valid: areSplitsValid,
        last_event_block: eventPointer.last_event_block,
        last_event_tx_index: eventPointer.last_event_tx_index,
        last_event_log_index: eventPointer.last_event_log_index,
      },
      whereColumns: ['account_id'],
      updateColumns: [
        'are_splits_valid',
        'last_event_block',
        'last_event_tx_index',
        'last_event_log_index',
      ],
    });

    if (result.rows.length === 0) {
      unreachable(`ORCID with account ID ${accountIdStr} disappeared during splits validation`);
    }

    const updatedLinkedIdentity = linkedIdentitySchema.parse(result.rows[0]);
    logger.info('orcid_splits_validity_updated', {
      accountId: accountIdStr,
      receiversHashFromEvent: splitsHashFromEvent,
      onChainCurrentSplitsHash,
      areSplitsValid,
      ownerAccountId: linkedIdentity.owner_account_id,
      identityType: updatedLinkedIdentity.identity_type,
    });
  } else if (isProject(accountIdStr)) {
    const project = await findOne<Project>({
      client,
      table: `${schema}.projects`,
      where: { account_id: accountIdStr },
      schema: projectSchema,
    });
    if (!project) {
      throw new Error(
        `Project with account ID ${accountIdStr} not found while processing splits but was expected to exist`,
      );
    }

    const { dbSplitsHash, onChainCurrentSplitsHash, areSplitsValid } = await validateSplits(
      accountIdStr,
      splitsRepo,
      contracts,
    );

    const verification_status = calculateProjectVerificationStatus(
      project.owner_address,
      project.owner_account_id,
      project.last_processed_ipfs_hash,
    );

    const result = await update<Project>({
      client,
      table: `${schema}.projects`,
      data: {
        account_id: accountIdStr,
        is_valid: areSplitsValid,
        verification_status,
        last_event_block: eventPointer.last_event_block,
        last_event_tx_index: eventPointer.last_event_tx_index,
        last_event_log_index: eventPointer.last_event_log_index,
      },
      whereColumns: ['account_id'],
      updateColumns: [
        'is_valid',
        'verification_status',
        'last_event_block',
        'last_event_tx_index',
        'last_event_log_index',
      ],
    });

    if (result.rows.length === 0) {
      unreachable(`Project with account ID ${accountIdStr} disappeared during splits validation`);
    }

    const updatedProject = projectSchema.parse(result.rows[0]);
    logger.info('project_splits_validity_updated', {
      accountId: accountIdStr,
      projectName: updatedProject.name,
      receiversHashFromEvent: splitsHashFromEvent,
      dbSplitsHash,
      onChainCurrentSplitsHash,
      areSplitsValid,
    });
  } else if (isNftDriverId(accountIdStr)) {
    const [dripList, ecosystem] = await Promise.all([
      findOne<DripList>({
        client,
        table: `${schema}.drip_lists`,
        where: { account_id: accountIdStr },
        schema: dripListSchema,
      }),
      findOne<EcosystemMainAccount>({
        client,
        table: `${schema}.ecosystem_main_accounts`,
        where: { account_id: accountIdStr },
        schema: ecosystemMainAccountSchema,
      }),
    ]);

    if (!dripList && !ecosystem) {
      throw new Error(
        `No drip list or ecosystem found for NFT Driver account ID ${accountIdStr} while processing splits but was expected to exist`,
      );
    }

    if (dripList && ecosystem) {
      unreachable(
        `Both Drip List and Ecosystem Main Account found for account ID '${accountIdStr}'`,
      );
    }

    const { dbSplitsHash, onChainCurrentSplitsHash, areSplitsValid } = await validateSplits(
      accountIdStr,
      splitsRepo,
      contracts,
    );

    if (dripList) {
      const result = await update<DripList>({
        client,
        table: `${schema}.drip_lists`,
        data: {
          account_id: accountIdStr,
          is_valid: areSplitsValid,
          last_event_block: eventPointer.last_event_block,
          last_event_tx_index: eventPointer.last_event_tx_index,
          last_event_log_index: eventPointer.last_event_log_index,
        },
        whereColumns: ['account_id'],
        updateColumns: [
          'is_valid',
          'last_event_block',
          'last_event_tx_index',
          'last_event_log_index',
        ],
      });

      if (result.rows.length === 0) {
        unreachable(
          `Drip List with account ID ${accountIdStr} disappeared during splits validation`,
        );
      }

      const updatedDripList = dripListSchema.parse(result.rows[0]);
      logger.info('drip_list_splits_validity_updated', {
        accountId: accountIdStr,
        dripListName: updatedDripList.name,
        receiversHashFromEvent: splitsHashFromEvent,
        dbSplitsHash,
        onChainCurrentSplitsHash,
        areSplitsValid,
      });
    } else {
      const result = await update<EcosystemMainAccount>({
        client,
        table: `${schema}.ecosystem_main_accounts`,
        data: {
          account_id: accountIdStr,
          is_valid: areSplitsValid,
          last_event_block: eventPointer.last_event_block,
          last_event_tx_index: eventPointer.last_event_tx_index,
          last_event_log_index: eventPointer.last_event_log_index,
        },
        whereColumns: ['account_id'],
        updateColumns: [
          'is_valid',
          'last_event_block',
          'last_event_tx_index',
          'last_event_log_index',
        ],
      });

      if (result.rows.length === 0) {
        unreachable(
          `Ecosystem with account ID ${accountIdStr} disappeared during splits validation`,
        );
      }

      const updatedEcosystem = ecosystemMainAccountSchema.parse(result.rows[0]);
      logger.info('ecosystem_splits_validity_updated', {
        accountId: accountIdStr,
        ecosystemName: updatedEcosystem.name,
        receiversHashFromEvent: splitsHashFromEvent,
        dbSplitsHash,
        onChainCurrentSplitsHash,
        areSplitsValid,
      });
    }
  } else if (isImmutableSplitsDriverId(accountIdStr)) {
    const subList = await findOne<SubList>({
      client,
      table: `${schema}.sub_lists`,
      where: { account_id: accountIdStr },
      schema: subListSchema,
    });
    if (!subList) {
      unreachable(
        `No sub list found for Immutable Splits Driver account ID ${accountIdStr} while processing splits but was expected to exist`,
      );
    }

    const { dbSplitsHash, onChainCurrentSplitsHash, areSplitsValid } = await validateSplits(
      accountIdStr,
      splitsRepo,
      contracts,
    );

    const result = await update<SubList>({
      client,
      table: `${schema}.sub_lists`,
      data: {
        account_id: accountIdStr,
        is_valid: areSplitsValid,
        last_event_block: eventPointer.last_event_block,
        last_event_tx_index: eventPointer.last_event_tx_index,
        last_event_log_index: eventPointer.last_event_log_index,
      },
      whereColumns: ['account_id'],
      updateColumns: [
        'is_valid',
        'last_event_block',
        'last_event_tx_index',
        'last_event_log_index',
      ],
    });

    if (result.rows.length === 0) {
      unreachable(`Sub List with account ID ${accountIdStr} disappeared during splits validation`);
    }

    logger.info('sub_list_splits_validity_updated', {
      accountId: accountIdStr,
      receiversHashFromEvent: splitsHashFromEvent,
      dbSplitsHash,
      onChainCurrentSplitsHash,
      areSplitsValid,
    });
  } else {
    logger.warn('unsupported_splits_set_account_type', { accountId: accountIdStr });
  }
};
