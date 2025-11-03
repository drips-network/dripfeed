import { fromHex, type DecodeEventLogReturnType } from 'viem';
import { createInsertSchema } from 'drizzle-zod';

import { isProject, isOrcidAccount } from '../../utils/repoDriverAccountUtils.js';
import { logger } from '../../logger.js';
import type { DripsAbi } from '../../chains/abis/abiTypes.js';
import type { EventHandler, HandlerEvent } from '../EventHandler.js';
import { isNftDriverId } from '../../utils/ntfDriverAccountIdUtils.js';
import { isImmutableSplitsDriverId } from '../../utils/immutableSplitsDriverUtils.js';
import { isAddressDriverId } from '../../utils/addressDriverAccountUtils.js';
import { toEventPointer } from '../../repositories/types.js';
import { upsert } from '../../db/db.js';
import { accountMetadataEmittedEvents } from '../../db/schema.js';

import { handleProjectMetadata } from './handleProjectMetadata.js';
import { handleDripListMetadata } from './handleDripListMetadata.js';
import { handleEcosystemMainAccountMetadata } from './handleEcosystemMainAccountMetadata.js';
import { handleSubListMetadata } from './handleSubListMetadata.js';

const accountMetadataEmittedEventSchema = createInsertSchema(accountMetadataEmittedEvents).omit({
  created_at: true,
  updated_at: true,
});

//  'ipfs' in hex, 32 bytes.
const DRIPS_APP_USER_METADATA_KEY =
  '0x6970667300000000000000000000000000000000000000000000000000000000';

type AccountMetadataEmittedEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<
    DripsAbi, // Drips
    'AccountMetadataEmitted'
  >['args'];
};

export const accountMetadataEmittedHandler: EventHandler<AccountMetadataEmittedEvent> = async (
  event,
  ctx,
) => {
  const { accountId, key, value } = event.args;
  const accountIdStr = accountId.toString();
  const cId = fromHex(value, 'string');

  const eventPointer = toEventPointer(event);

  const accountMetadataEmittedEvent = accountMetadataEmittedEventSchema.parse({
    key,
    value,
    account_id: accountIdStr,
    log_index: event.logIndex,
    block_number: event.blockNumber,
    block_timestamp: event.blockTimestamp,
    transaction_hash: event.txHash,
  });

  await upsert({
    client: ctx.client,
    table: `${ctx.schema}.account_metadata_emitted_events`,
    data: accountMetadataEmittedEvent,
    conflictColumns: ['transaction_hash', 'log_index'],
  });

  if (key !== DRIPS_APP_USER_METADATA_KEY) {
    logger.warn('unsupported_account_metadata_key', { key });
    return;
  }

  if (isOrcidAccount(accountIdStr)) {
    logger.info('orcid_account_metadata_ignored', { accountId });
    return;
  }

  if (isAddressDriverId(accountIdStr)) {
    logger.info('address_driver_account_metadata_ignored', { accountId });
    return;
  }

  if (isProject(accountIdStr)) {
    await handleProjectMetadata(
      accountIdStr,
      event.blockTimestamp,
      event.blockNumber,
      cId,
      ctx,
      eventPointer,
    );
  } else if (isNftDriverId(accountIdStr)) {
    const { metadataService } = ctx;
    const metadata = await metadataService.getNftDriverAccountMetadata(cId);

    if (metadataService.isDripListMetadata(metadata)) {
      await handleDripListMetadata(
        accountIdStr,
        event.blockTimestamp,
        event.blockNumber,
        cId,
        metadata,
        ctx,
        eventPointer,
      );
    } else if (metadataService.isEcosystemMainAccountMetadata(metadata)) {
      await handleEcosystemMainAccountMetadata(
        accountIdStr,
        event.blockTimestamp,
        event.blockNumber,
        cId,
        metadata,
        ctx,
        eventPointer,
      );
    } else {
      logger.warn('unsupported_nft_driver_account_metadata_type', { accountId });
      return;
    }
  } else if (isImmutableSplitsDriverId(accountIdStr)) {
    await handleSubListMetadata(
      accountIdStr,
      event.blockTimestamp,
      event.blockNumber,
      cId,
      ctx,
      eventPointer,
    );
  } else {
    logger.warn('unsupported_account_metadata_account_type', { accountId, cId });
    return;
  }

  await ctx.cacheInvalidationService.invalidate(
    (await ctx.splitsRepo.getCurrentSplitReceiversBySender(accountIdStr)).map(
      (sr) => sr.receiver_account_id,
    ),
    event.blockTimestamp,
  );
};
