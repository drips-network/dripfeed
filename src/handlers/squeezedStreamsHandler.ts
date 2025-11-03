import type { DecodeEventLogReturnType } from 'viem';
import { createInsertSchema } from 'drizzle-zod';

import type { DripsAbi } from '../chains/abis/abiTypes.js';
import { logger } from '../logger.js';
import { upsert } from '../db/db.js';
import { squeezedStreamsEvents } from '../db/schema.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

const squeezedStreamsEventSchema = createInsertSchema(squeezedStreamsEvents).omit({
  created_at: true,
  updated_at: true,
});

type SqueezedStreamsEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<DripsAbi, 'SqueezedStreams'>['args'];
};

export const squeezedStreamsHandler: EventHandler<SqueezedStreamsEvent> = async (event, ctx) => {
  const { accountId, erc20, senderId, amt, streamsHistoryHashes } = event.args;
  const { client, schema } = ctx;

  const squeezedStreamsEvent = squeezedStreamsEventSchema.parse({
    account_id: accountId.toString(),
    erc20: erc20.toLowerCase(),
    sender_id: senderId.toString(),
    amount: amt.toString(),
    streams_history_hashes: JSON.stringify(streamsHistoryHashes),
    log_index: event.logIndex,
    block_number: event.blockNumber,
    block_timestamp: event.blockTimestamp,
    transaction_hash: event.txHash,
  });

  await upsert({
    client,
    table: `${schema}.squeezed_streams_events`,
    data: squeezedStreamsEvent,
    conflictColumns: ['transaction_hash', 'log_index'],
  });

  logger.info('squeezed_streams_event_processed', {
    accountId: accountId.toString(),
    erc20,
    senderId: senderId.toString(),
    amt: amt.toString(),
  });
};
