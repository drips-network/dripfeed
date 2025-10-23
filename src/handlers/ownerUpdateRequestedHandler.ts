import { fromHex, type DecodeEventLogReturnType } from 'viem';

import type { RepoDriverAbi } from '../chains/abis/abiTypes.js';
import { logger } from '../logger.js';
import { mapForge } from '../utils/forgeUtils.js';
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
  const { projectsRepo: projects } = ctx;

  const eventPointer = toEventPointer(event);
  const accountIdStr = accountId.toString();

  const project = await projects.ensureUnclaimedProject(
    {
      account_id: accountIdStr,
      forge: mapForge(Number(forge)),
      name: fromHex(name, 'string'),
    },
    eventPointer,
  );

  logger.info('project_created_or_reset', { project });
};
