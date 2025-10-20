import { type DecodeEventLogReturnType } from 'viem';

import type { DripsAbi } from '../chain-configs/all-chains.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

type StreamReceiverSeen = HandlerEvent & {
  args: DecodeEventLogReturnType<DripsAbi, 'StreamReceiverSeen'>['args'];
};

export const streamReceiverSeenHandler: EventHandler<StreamReceiverSeen> = async (event, ctx) => {
  const { receiversHash } = event.args;
  const { cacheInvalidationService, splitsRepo } = ctx;

  const splits = await splitsRepo.getCurrentSplitReceiversByReceiversHash(receiversHash);

  await cacheInvalidationService.invalidate(
    splits.map((split) => split.id.toString()),
    event.blockTimestamp,
  );
};
