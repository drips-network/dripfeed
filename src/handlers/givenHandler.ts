import type { DecodeEventLogReturnType } from 'viem';
import { createInsertSchema } from 'drizzle-zod';

import type { DripsAbi } from '../chains/abis/abiTypes.js';
import { logger } from '../logger.js';
import { upsert } from '../db/db.js';
import { givenEvents } from '../db/schema.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

const givenEventSchema = createInsertSchema(givenEvents).omit({
  created_at: true,
  updated_at: true,
});

type GivenEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<DripsAbi, 'Given'>['args'];
};

export const givenHandler: EventHandler<GivenEvent> = async (event, ctx) => {
  const { accountId, receiver, erc20, amt } = event.args;
  const { client, schema } = ctx;

  const givenEvent = givenEventSchema.parse({
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
    table: `${schema}.given_events`,
    data: givenEvent,
    conflictColumns: ['transaction_hash', 'log_index'],
  });

  logger.info('given_event_processed', {
    accountId: accountId.toString(),
    receiver: receiver.toString(),
    erc20,
    amt: amt.toString(),
  });
};
