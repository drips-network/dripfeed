import type { DecodeEventLogReturnType } from 'viem';

import type { DripsAbi } from '../chains/abis/abiTypes.js';
import { logger } from '../logger.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

type GivenEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<DripsAbi, 'Given'>['args'];
};

export const givenHandler: EventHandler<GivenEvent> = async (event, ctx) => {
  const { accountId, receiver, erc20, amt } = event.args;
  const { givenEventsRepo } = ctx;

  await givenEventsRepo.upsert({
    account_id: accountId.toString(),
    receiver: receiver.toString(),
    erc20: erc20.toLowerCase(),
    amt: amt.toString(),
    log_index: event.logIndex,
    block_number: event.blockNumber,
    block_timestamp: event.blockTimestamp,
    transaction_hash: event.txHash,
  });

  logger.info('given_event_processed', {
    accountId: accountId.toString(),
    receiver: receiver.toString(),
    erc20,
    amt: amt.toString(),
  });
};
