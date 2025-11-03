import { type DecodeEventLogReturnType } from 'viem';

import type { RepoDriverAbi } from '../chains/abis/abiTypes.js';
import { logger } from '../logger.js';
import { isOrcidAccount, isProject } from '../utils/repoDriverAccountUtils.js';
import { toEventPointer } from '../repositories/types.js';
import { findOne, update } from '../db/db.js';
import {
  projectSchema,
  type Project,
  linkedIdentitySchema,
  type LinkedIdentity,
} from '../db/schemas.js';
import { calculateProjectVerificationStatus } from '../utils/calculateProjectVerificationStatus.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

type OwnerUpdatedEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<RepoDriverAbi, 'OwnerUpdated'>['args'];
};

export const ownerUpdatedHandler: EventHandler<OwnerUpdatedEvent> = async (event, ctx) => {
  const { accountId, owner } = event.args;
  const { client, schema, contracts, cacheInvalidationService } = ctx;
  const eventPointer = toEventPointer(event);
  const accountIdStr = accountId.toString();
  const ownerAccountIdStr = (await contracts.addressDriver.read.calcAccountId([owner])).toString();

  if (isProject(accountIdStr)) {
    const currentProject = await findOne<Project>({
      client,
      table: `${schema}.projects`,
      where: { account_id: accountIdStr },
      schema: projectSchema,
    });

    if (!currentProject) {
      throw new Error(`Project not found for account_id: ${accountIdStr}`);
    }

    const verification_status = calculateProjectVerificationStatus(
      owner,
      ownerAccountIdStr,
      currentProject.last_processed_ipfs_hash,
    );

    const result = await update<Project>({
      client,
      table: `${schema}.projects`,
      data: {
        account_id: accountIdStr,
        owner_address: owner,
        owner_account_id: ownerAccountIdStr,
        claimed_at: event.blockTimestamp,
        verification_status,
        last_event_block: eventPointer.last_event_block,
        last_event_tx_index: eventPointer.last_event_tx_index,
        last_event_log_index: eventPointer.last_event_log_index,
      },
      whereColumns: ['account_id'],
      updateColumns: [
        'owner_address',
        'owner_account_id',
        'claimed_at',
        'verification_status',
        'last_event_block',
        'last_event_tx_index',
        'last_event_log_index',
      ],
    });

    if (result.rows.length === 0) {
      throw new Error(`Project owner update affected 0 rows for account_id: ${accountIdStr}`);
    }

    const project = projectSchema.parse(result.rows[0]);
    logger.info('project_owner_updated', { project });
  } else if (isOrcidAccount(accountIdStr)) {
    const result = await update<LinkedIdentity>({
      client,
      table: `${schema}.linked_identities`,
      data: {
        account_id: accountIdStr,
        owner_address: owner,
        owner_account_id: ownerAccountIdStr,
        claimed_at: event.blockTimestamp,
        last_event_block: eventPointer.last_event_block,
        last_event_tx_index: eventPointer.last_event_tx_index,
        last_event_log_index: eventPointer.last_event_log_index,
      },
      whereColumns: ['account_id'],
      updateColumns: [
        'owner_address',
        'owner_account_id',
        'claimed_at',
        'last_event_block',
        'last_event_tx_index',
        'last_event_log_index',
      ],
    });

    if (result.rows.length === 0) {
      throw new Error(`Linked identity not found for account_id: ${accountIdStr}`);
    }

    const linkedIdentity = linkedIdentitySchema.parse(result.rows[0]);
    logger.info('orcid_owner_updated', { linkedIdentity });
  } else {
    logger.warn('owner_updated_unsupported_account', { accountId: accountIdStr });
  }

  await cacheInvalidationService.invalidate(
    [accountIdStr, ownerAccountIdStr],
    event.blockTimestamp,
  );
};
