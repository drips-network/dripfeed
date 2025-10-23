import { type DecodeEventLogReturnType } from 'viem';

import type { DripsAbi } from '../chains/abis/abiTypes.js';
import { logger } from '../logger.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

type StreamReceiverSeen = HandlerEvent & {
  args: DecodeEventLogReturnType<DripsAbi, 'StreamReceiverSeen'>['args'];
};

export const streamReceiverSeenHandler: EventHandler<StreamReceiverSeen> = async (event, ctx) => {
  const { receiversHash, accountId, config } = event.args;
  const { cacheInvalidationService, splitsRepo, streamReceiverSeenEventsRepo } = ctx;

  await streamReceiverSeenEventsRepo.upsert({
    account_id: accountId.toString(),
    config: config.toString(),
    receivers_hash: receiversHash,
    log_index: event.logIndex,
    block_number: event.blockNumber,
    block_timestamp: event.blockTimestamp,
    transaction_hash: event.txHash,
  });

  logger.info('stream_receiver_seen_event_processed', {
    accountId: accountId.toString(),
    config: config.toString(),
    receiversHash,
  });

  const splits = await splitsRepo.getCurrentSplitReceiversByReceiversHash(receiversHash);

  await cacheInvalidationService.invalidate(
    splits.map((split) => split.id.toString()),
    event.blockTimestamp,
  );
};
