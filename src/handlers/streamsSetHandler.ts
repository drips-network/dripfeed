import type { DecodeEventLogReturnType } from 'viem';
import { createInsertSchema } from 'drizzle-zod';

import type { DripsAbi } from '../chains/abis/abiTypes.js';
import { logger } from '../logger.js';
import { upsert } from '../db/db.js';
import { streamsSetEvents } from '../db/schema.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

const streamsSetEventSchema = createInsertSchema(streamsSetEvents).omit({
  created_at: true,
  updated_at: true,
});

type StreamsSetEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<DripsAbi, 'StreamsSet'>['args'];
};

export const streamsSetHandler: EventHandler<StreamsSetEvent> = async (event, ctx) => {
  const { accountId, erc20, receiversHash, streamsHistoryHash, balance, maxEnd } = event.args;
  const { client, schema } = ctx;

  const streamsSetEvent = streamsSetEventSchema.parse({
    account_id: accountId.toString(),
    erc20: erc20.toLowerCase(),
    receivers_hash: receiversHash,
    streams_history_hash: streamsHistoryHash,
    balance: balance.toString(),
    max_end: maxEnd.toString(),
    log_index: event.logIndex,
    block_number: event.blockNumber,
    block_timestamp: event.blockTimestamp,
    transaction_hash: event.txHash,
  });

  await upsert({
    client,
    table: `${schema}.streams_set_events`,
    data: streamsSetEvent,
    conflictColumns: ['transaction_hash', 'log_index'],
  });

  logger.info('streams_set_event_processed', {
    accountId: accountId.toString(),
    erc20,
    receiversHash,
    streamsHistoryHash,
    balance: balance.toString(),
    maxEnd: maxEnd.toString(),
  });
};
