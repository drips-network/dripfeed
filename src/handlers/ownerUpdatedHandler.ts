import { type DecodeEventLogReturnType } from 'viem';

import type { RepoDriverAbi } from '../chains/abis/abiTypes.js';
import { logger } from '../logger.js';
import { isOrcidAccount, isProject } from '../utils/repoDriverAccountUtils.js';
import { toEventPointer } from '../repositories/types.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

type OwnerUpdatedEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<RepoDriverAbi, 'OwnerUpdated'>['args'];
};

export const ownerUpdatedHandler: EventHandler<OwnerUpdatedEvent> = async (event, ctx) => {
  const { accountId, owner } = event.args;
  const { projectsRepo, linkedIdentitiesRepo, contracts, cacheInvalidationService } = ctx;

  const eventPointer = toEventPointer(event);
  const accountIdStr = accountId.toString();
  const ownerAccountIdStr = (await contracts.addressDriver.read.calcAccountId([owner])).toString();

  if (isProject(accountIdStr)) {
    const result = await projectsRepo.updateProject(
      {
        account_id: accountIdStr,
        owner_address: owner,
        owner_account_id: ownerAccountIdStr,
        claimed_at: event.blockTimestamp,
      },
      eventPointer,
    );

    if (!result.success) {
      throw new Error(`Project not found for account_id: ${accountIdStr}`);
    }

    logger.info('project_owner_updated', { project: result.data });
  } else if (isOrcidAccount(accountIdStr)) {
    const result = await linkedIdentitiesRepo.updateLinkedIdentity(
      {
        account_id: accountIdStr,
        owner_address: owner,
        owner_account_id: ownerAccountIdStr,
        claimed_at: event.blockTimestamp,
      },
      eventPointer,
    );

    if (!result.success) {
      throw new Error(`Linked identity not found for account_id: ${accountIdStr}`);
    }

    logger.info('orcid_owner_updated', { linkedIdentity: result.data });
  } else {
    logger.warn('owner_updated_unsupported_account', { accountId: accountIdStr });
  }

  await cacheInvalidationService.invalidate(
    [accountIdStr, ownerAccountIdStr],
    event.blockTimestamp,
  );
};
