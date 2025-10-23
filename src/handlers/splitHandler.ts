import { type DecodeEventLogReturnType } from 'viem';

import type { DripsAbi } from '../chains/abis/abiTypes.js';
import { logger } from '../logger.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

type SplitEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<DripsAbi, 'Split'>['args'];
};

export const splitHandler: EventHandler<SplitEvent> = async (event, ctx) => {
  const { accountId, receiver, erc20, amt } = event.args;
  const { splitEventsRepo } = ctx;

  await splitEventsRepo.upsert({
    account_id: accountId.toString(),
    receiver: receiver.toString(),
    erc20: erc20.toLowerCase(),
    amt: amt.toString(),
    log_index: event.logIndex,
    block_number: event.blockNumber,
    block_timestamp: event.blockTimestamp,
    transaction_hash: event.txHash,
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
