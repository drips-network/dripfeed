import type { DecodeEventLogReturnType } from 'viem';

import type { DripsAbi } from '../chain-configs/all-chains.js';
import { logger } from '../logger.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

type SqueezedStreamsEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<DripsAbi, 'SqueezedStreams'>['args'];
};

export const squeezedStreamsHandler: EventHandler<SqueezedStreamsEvent> = async (event, ctx) => {
  const { accountId, erc20, senderId, amt, streamsHistoryHashes } = event.args;
  const { squeezedStreamsEventsRepo } = ctx;

  await squeezedStreamsEventsRepo.upsert({
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

  logger.info('squeezed_streams_event_processed', {
    accountId: accountId.toString(),
    erc20,
    senderId: senderId.toString(),
    amt: amt.toString(),
  });
};
