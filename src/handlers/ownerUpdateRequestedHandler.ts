import { fromHex, type DecodeEventLogReturnType } from 'viem';

import type { RepoDriverAbi } from '../chains/abis/abiTypes.js';
import { logger } from '../logger.js';
import { mapForge, forgeToUrl } from '../utils/forgeUtils.js';
import { isOrcidAccount, isProject } from '../utils/repoDriverAccountUtils.js';
import { toEventPointer } from '../repositories/types.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

type OwnerUpdateRequested = HandlerEvent & {
  args: DecodeEventLogReturnType<RepoDriverAbi, 'OwnerUpdateRequested'>['args'];
};

export const ownerUpdateRequestedHandler: EventHandler<OwnerUpdateRequested> = async (
  event,
  ctx,
) => {
  const { accountId, forge, name } = event.args;
  const { projectsRepo, linkedIdentitiesRepo } = ctx;
  const eventPointer = toEventPointer(event);
  const accountIdStr = accountId.toString();
  const nameStr = fromHex(name, 'string');

  if (isProject(accountIdStr)) {
    const forgeValue = mapForge(Number(forge));
    const { project, created } = await projectsRepo.ensureUnclaimedProject(
      {
        account_id: accountIdStr,
        forge: forgeValue,
        name: nameStr,
        url: forgeToUrl(forgeValue, nameStr),
      },
      eventPointer,
    );

    if (created) {
      logger.info('owner_update_requested_project_created', { project });
    } else {
      logger.info('owner_update_requested_project_exists', { project });
    }
  } else if (isOrcidAccount(accountIdStr)) {
    const { linkedIdentity, created } = await linkedIdentitiesRepo.ensureUnclaimedLinkedIdentity(
      {
        account_id: accountIdStr,
        identity_type: 'orcid',
      },
      eventPointer,
    );

    if (created) {
      logger.info('owner_update_requested_linked_identity_created', { linkedIdentity });
    } else {
      logger.info('owner_update_requested_linked_identity_exists', { linkedIdentity });
    }
  } else {
    logger.warn('owner_update_requested_unsupported_account', { accountId: accountIdStr });
  }
};
