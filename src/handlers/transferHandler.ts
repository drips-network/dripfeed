import { zeroAddress, type DecodeEventLogReturnType } from 'viem';
import { createInsertSchema } from 'drizzle-zod';

import type { NftDriverAbi } from '../chains/abis/abiTypes.js';
import { logger } from '../logger.js';
import { toEventPointer } from '../repositories/types.js';
import { upsert, update } from '../db/db.js';
import { transferEvents } from '../db/schema.js';
import {
  dripListSchema,
  type DripList,
  ecosystemMainAccountSchema,
  type EcosystemMainAccount,
} from '../db/schemas.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

const transferEventSchema = createInsertSchema(transferEvents).omit({
  created_at: true,
  updated_at: true,
});

type TransferEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<NftDriverAbi, 'Transfer'>['args'];
};

export const transferHandler: EventHandler<TransferEvent> = async (event, ctx) => {
  const { from, to, tokenId } = event.args;
  const {
    client,
    schema,
    pendingNftTransfersRepo,
    contracts,
    visibilityThresholdBlockNumber,
    cacheInvalidationService,
  } = ctx;

  const transferEvent = transferEventSchema.parse({
    from,
    to,
    token_id: tokenId.toString(),
    log_index: event.logIndex,
    block_number: event.blockNumber,
    block_timestamp: event.blockTimestamp,
    transaction_hash: event.txHash,
  });

  await upsert({
    client,
    table: `${schema}.transfer_events`,
    data: transferEvent,
    conflictColumns: ['transaction_hash', 'log_index'],
  });

  const eventPointer = toEventPointer(event);
  const accountId = tokenId.toString();
  const isMint = from === zeroAddress;
  const ownerAccountId = (await contracts.addressDriver.read.calcAccountId([to])).toString();

  await cacheInvalidationService.invalidate(
    [
      accountId,
      (await contracts.addressDriver.read.calcAccountId([from])).toString(),
      ownerAccountId,
    ],
    event.blockTimestamp,
  );

  const commonData = {
    owner_address: to,
    owner_account_id: ownerAccountId,
    previous_owner_address: from,
    is_visible:
      event.blockNumber > visibilityThresholdBlockNumber
        ? isMint // If it's a mint, then the entity will be visible. If it's a real transfer, then it's not.
        : true, // If the block number is less than or equal to the visibility threshold, then the entity is visible by default.
  };

  const dripListUpdates = {
    account_id: accountId,
    ...commonData,
    ...(isMint && { creator: to }),
    last_event_block: eventPointer.last_event_block,
    last_event_tx_index: eventPointer.last_event_tx_index,
    last_event_log_index: eventPointer.last_event_log_index,
  };

  const dripListResult = await update<DripList>({
    client,
    table: `${schema}.drip_lists`,
    data: dripListUpdates,
    whereColumns: ['account_id'],
    updateColumns: [
      'owner_address',
      'owner_account_id',
      'previous_owner_address',
      'is_visible',
      ...(isMint ? ['creator' as const] : []),
      'last_event_block',
      'last_event_tx_index',
      'last_event_log_index',
    ],
  });

  if (dripListResult.rows.length > 0) {
    const dripList = dripListSchema.parse(dripListResult.rows[0]);
    logger.info('drip_list_transfer_processed', {
      accountId,
      isMint,
      from,
      to,
      dripList,
    });
    return;
  }

  const ecosystemUpdates = {
    account_id: accountId,
    ...commonData,
    ...(isMint && { creator: to }),
    last_event_block: eventPointer.last_event_block,
    last_event_tx_index: eventPointer.last_event_tx_index,
    last_event_log_index: eventPointer.last_event_log_index,
  };

  const ecosystemResult = await update<EcosystemMainAccount>({
    client,
    table: `${schema}.ecosystem_main_accounts`,
    data: ecosystemUpdates,
    whereColumns: ['account_id'],
    updateColumns: [
      'owner_address',
      'owner_account_id',
      'previous_owner_address',
      'is_visible',
      ...(isMint ? ['creator' as const] : []),
      'last_event_block',
      'last_event_tx_index',
      'last_event_log_index',
    ],
  });

  if (ecosystemResult.rows.length > 0) {
    const ecosystem = ecosystemMainAccountSchema.parse(ecosystemResult.rows[0]);
    logger.info('ecosystem_transfer_processed', {
      accountId,
      isMint,
      from,
      to,
      ecosystem,
    });
    return;
  }

  // Neither drip list nor ecosystem exists, store in pending table.
  // The actual type will be determined when metadata is emitted.
  await pendingNftTransfersRepo.upsertPendingNftTransfer(
    {
      account_id: accountId,
      ...commonData,
      creator: isMint ? to : null,
      block_number: event.blockNumber,
    },
    eventPointer,
  );

  logger.info('nft_transfer_pending', {
    accountId,
    isMint,
    from,
    to,
    blockNumber: event.blockNumber,
  });
};
