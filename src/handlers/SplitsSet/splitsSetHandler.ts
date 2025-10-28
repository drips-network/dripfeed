import { type DecodeEventLogReturnType } from 'viem';

import type { DripsAbi } from '../../chains/abis/abiTypes.js';
import { logger } from '../../logger.js';
import { isOrcidAccount, isProject } from '../../utils/repoDriverAccountUtils.js';
import { isNftDriverId } from '../../utils/ntfDriverAccountIdUtils.js';
import { isImmutableSplitsDriverId } from '../../utils/immutableSplitsDriverUtils.js';
import { toEventPointer } from '../../repositories/types.js';
import { unreachable } from '../../utils/unreachable.js';
import type { EventHandler, HandlerEvent } from '../EventHandler.js';
import { validateSplits } from '../../utils/validateSplits.js';

import { isSplittingToOwnerOnly } from './isSplittingToOwnerOnly.js';

type SplitsSetEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<DripsAbi, 'SplitsSet'>['args'];
};

export const splitsSetHandler: EventHandler<SplitsSetEvent> = async (event, ctx) => {
  const { accountId, receiversHash: splitsHashFromEvent } = event.args;
  const {
    projectsRepo,
    linkedIdentitiesRepo,
    dripListsRepo,
    ecosystemsRepo,
    subListsRepo,
    splitsRepo,
    splitsSetEventsRepo,
    contracts,
  } = ctx;

  await splitsSetEventsRepo.upsert({
    account_id: accountId.toString(),
    receivers_hash: splitsHashFromEvent,
    log_index: event.logIndex,
    block_number: event.blockNumber,
    block_timestamp: event.blockTimestamp,
    transaction_hash: event.txHash,
  });

  // "Unsafe" calls are acceptable here for "valid NOW" semantics:
  // - Non-deterministic: same historic event may produce different results if reprocessed later
  // - Eventual consistency: after catch-up, only the latest SplitsSet has is_valid=true
  // This trade-off is intentional to validate current on-chain state, not historic state.

  const accountIdStr = accountId.toString();
  const eventPointer = toEventPointer(event);

  if (isOrcidAccount(accountIdStr)) {
    const linkedIdentity = await linkedIdentitiesRepo.getLinkedIdentity(accountIdStr);
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

    const result = await linkedIdentitiesRepo.updateLinkedIdentity(
      {
        account_id: accountIdStr,
        are_splits_valid: areSplitsValid,
      },
      eventPointer,
    );

    if (!result.success) {
      unreachable(`ORCID with account ID ${accountIdStr} disappeared during splits validation`);
    }

    logger.info('orcid_splits_validity_updated', {
      accountId: accountIdStr,
      receiversHashFromEvent: splitsHashFromEvent,
      onChainCurrentSplitsHash,
      areSplitsValid,
      ownerAccountId: linkedIdentity.owner_account_id,
      identityType: result.data.identity_type,
    });
  } else if (isProject(accountIdStr)) {
    const project = await ctx.projectsRepo.findById(accountIdStr);
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

    const result = await projectsRepo.updateProject(
      {
        account_id: accountIdStr,
        is_valid: areSplitsValid,
      },
      eventPointer,
    );

    if (!result.success) {
      unreachable(`Project with account ID ${accountIdStr} disappeared during splits validation`);
    }

    logger.info('project_splits_validity_updated', {
      accountId: accountIdStr,
      projectName: result.data.name,
      receiversHashFromEvent: splitsHashFromEvent,
      dbSplitsHash,
      onChainCurrentSplitsHash,
      areSplitsValid,
    });
  } else if (isNftDriverId(accountIdStr)) {
    const [dripList, ecosystem] = await Promise.all([
      dripListsRepo.findById(accountIdStr),
      ecosystemsRepo.findById(accountIdStr),
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
      const result = await dripListsRepo.updateDripList(
        {
          account_id: accountIdStr,
          is_valid: areSplitsValid,
        },
        eventPointer,
      );

      if (!result.success) {
        unreachable(
          `Drip List with account ID ${accountIdStr} disappeared during splits validation`,
        );
      }

      logger.info('drip_list_splits_validity_updated', {
        accountId: accountIdStr,
        dripListName: result.data.name,
        receiversHashFromEvent: splitsHashFromEvent,
        dbSplitsHash,
        onChainCurrentSplitsHash,
        areSplitsValid,
      });
    } else {
      const result = await ecosystemsRepo.updateEcosystemMainAccount(
        {
          account_id: accountIdStr,
          is_valid: areSplitsValid,
        },
        eventPointer,
      );

      if (!result.success) {
        unreachable(
          `Ecosystem with account ID ${accountIdStr} disappeared during splits validation`,
        );
      }

      logger.info('ecosystem_splits_validity_updated', {
        accountId: accountIdStr,
        ecosystemName: result.data.name,
        receiversHashFromEvent: splitsHashFromEvent,
        dbSplitsHash,
        onChainCurrentSplitsHash,
        areSplitsValid,
      });
    }
  } else if (isImmutableSplitsDriverId(accountIdStr)) {
    const subList = await subListsRepo.findById(accountIdStr);
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

    const result = await subListsRepo.updateSubList(
      {
        account_id: accountIdStr,
        is_valid: areSplitsValid,
      },
      eventPointer,
    );

    if (!result.success) {
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
