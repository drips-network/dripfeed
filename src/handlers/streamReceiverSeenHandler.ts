import { type DecodeEventLogReturnType } from 'viem';
import { createInsertSchema } from 'drizzle-zod';

import type { DripsAbi } from '../chains/abis/abiTypes.js';
import { logger } from '../logger.js';
import { upsert } from '../db/db.js';
import { streamReceiverSeenEvents } from '../db/schema.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

const streamReceiverSeenEventSchema = createInsertSchema(streamReceiverSeenEvents).omit({
  created_at: true,
  updated_at: true,
});

type StreamReceiverSeen = HandlerEvent & {
  args: DecodeEventLogReturnType<DripsAbi, 'StreamReceiverSeen'>['args'];
};

export const streamReceiverSeenHandler: EventHandler<StreamReceiverSeen> = async (event, ctx) => {
  const { receiversHash, accountId, config } = event.args;
  const { cacheInvalidationService, splitsRepo, client, schema } = ctx;

  const streamReceiverSeenEvent = streamReceiverSeenEventSchema.parse({
    account_id: accountId.toString(),
    config: config.toString(),
    receivers_hash: receiversHash,
    log_index: event.logIndex,
    block_number: event.blockNumber,
    block_timestamp: event.blockTimestamp,
    transaction_hash: event.txHash,
  });

  await upsert({
    client,
    table: `${schema}.stream_receiver_seen_events`,
    data: streamReceiverSeenEvent,
    conflictColumns: ['transaction_hash', 'log_index'],
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
