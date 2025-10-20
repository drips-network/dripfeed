import { zeroAddress, type DecodeEventLogReturnType } from 'viem';

import type { NftDriverAbi } from '../chain-configs/all-chains.js';
import { logger } from '../logger.js';
import type { UpdateDripListData } from '../repositories/DripListsRepository.js';
import type { UpdateEcosystemMainAccountData } from '../repositories/EcosystemsRepository.js';
import { toEventPointer } from '../repositories/types.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

type TransferEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<NftDriverAbi, 'Transfer'>['args'];
};

export const transferHandler: EventHandler<TransferEvent> = async (event, ctx) => {
  const { from, to, tokenId } = event.args;
  const {
    dripListsRepo,
    ecosystemsRepo,
    pendingNftTransfersRepo,
    contracts,
    visibilityThresholdBlockNumber,
    cacheInvalidationService,
  } = ctx;

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

  const dripListUpdates: UpdateDripListData = {
    account_id: accountId,
    ...commonData,
  };

  if (isMint) {
    dripListUpdates.creator = to;
  }

  const dripListResult = await dripListsRepo.updateDripList(dripListUpdates, eventPointer);

  if (dripListResult.success) {
    logger.info('drip_list_transfer_processed', {
      accountId,
      isMint,
      from,
      to,
    });
    return;
  }

  const ecosystemUpdates: UpdateEcosystemMainAccountData = {
    account_id: accountId,
    ...commonData,
  };

  if (isMint) {
    ecosystemUpdates.creator = to;
  }

  const ecosystemResult = await ecosystemsRepo.updateEcosystemMainAccount(ecosystemUpdates, eventPointer);

  if (ecosystemResult.success) {
    logger.info('ecosystem_transfer_processed', {
      accountId,
      isMint,
      from,
      to,
    });
    return;
  }

  // Neither drip list nor ecosystem exists, store in pending table.
  // The actual type will be determined when metadata is emitted.
  await pendingNftTransfersRepo.upsertPendingNftTransfer({
    account_id: accountId,
    ...commonData,
    creator: isMint ? to : null,
    block_number: event.blockNumber,
  }, eventPointer);

  logger.info('nft_transfer_pending', {
    accountId,
    isMint,
    from,
    to,
    blockNumber: event.blockNumber,
  });
};
