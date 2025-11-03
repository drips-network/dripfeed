import { type DecodeEventLogReturnType } from 'viem';
import { createInsertSchema } from 'drizzle-zod';

import type { DripsAbi } from '../chains/abis/abiTypes.js';
import { logger } from '../logger.js';
import { upsert } from '../db/db.js';
import { splitEvents } from '../db/schema.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

const splitEventSchema = createInsertSchema(splitEvents).omit({
  created_at: true,
  updated_at: true,
});

type SplitEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<DripsAbi, 'Split'>['args'];
};

export const splitHandler: EventHandler<SplitEvent> = async (event, ctx) => {
  const { accountId, receiver, erc20, amt } = event.args;
  const { client, schema } = ctx;

  const splitEvent = splitEventSchema.parse({
    account_id: accountId.toString(),
    receiver: receiver.toString(),
    erc20: erc20.toLowerCase(),
    amt: amt.toString(),
    log_index: event.logIndex,
    block_number: event.blockNumber,
    block_timestamp: event.blockTimestamp,
    transaction_hash: event.txHash,
  });

  await upsert({
    client,
    table: `${schema}.split_events`,
    data: splitEvent,
    conflictColumns: ['transaction_hash', 'log_index'],
  });

  logger.info('split_event_recorded', {
    accountId: accountId.toString(),
    receiver: receiver.toString(),
    erc20,
    amt: amt.toString(),
    blockNumber: event.blockNumber,
    txHash: event.txHash,
  });
};
