import type { DecodeEventLogReturnType } from 'viem';

import type { DripsAbi } from '../chain-configs/all-chains.js';
import { logger } from '../logger.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

type StreamsSetEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<DripsAbi, 'StreamsSet'>['args'];
};

export const streamsSetHandler: EventHandler<StreamsSetEvent> = async (event, ctx) => {
  const { accountId, erc20, receiversHash, streamsHistoryHash, balance, maxEnd } = event.args;
  const { streamsSetEventsRepo } = ctx;

  await streamsSetEventsRepo.upsert({
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

  logger.info('streams_set_event_processed', {
    accountId: accountId.toString(),
    erc20,
    receiversHash,
    streamsHistoryHash,
    balance: balance.toString(),
    maxEnd: maxEnd.toString(),
  });
};
