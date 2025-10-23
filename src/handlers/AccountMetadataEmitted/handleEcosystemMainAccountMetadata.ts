import type z from 'zod';

import type { HandlerContext } from '../EventHandler.js';
import type { gitHubSourceSchema } from '../../metadata/schemas/common/sources.js';
import type { SplitsRepository, SplitReceiverInput } from '../../repositories/SplitsRepository.js';
import type { EcosystemMainAccountMetadata } from '../../services/MetadataService.js';
import { logger } from '../../logger.js';
import { verifyProjectSources } from '../../utils/verifyProjectSources.js';
import { mapToAccountType } from '../../utils/mapToAccountType.js';
import { getReceiverTypeFromMetadata } from '../../utils/metadataTypeMapping.js';
import { assertValidReceiverType } from '../../utils/splitRules.js';
import type { EventPointer } from '../../repositories/types.js';

type EcosystemRecipient = EcosystemMainAccountMetadata['recipients'][number];

export async function handleEcosystemMainAccountMetadata(
  accountId: string,
  blockTimestamp: Date,
  blockNumber: bigint,
  cId: string,
  metadata: EcosystemMainAccountMetadata,
  ctx: HandlerContext,
  eventPointer: EventPointer,
): Promise<void> {
  if (accountId !== metadata.describes?.accountId) {
    throw new Error(
      `Ecosystem ID ${accountId} does not match metadata account ID ${metadata.describes?.accountId}`,
    );
  }

  const recipients = metadata.recipients;

  await verifyGitHubProjectSources(recipients, ctx);
  await updateEcosystemMainAccount(metadata, cId, accountId, blockNumber, ctx, eventPointer);
  await updateEcosystemSplits(accountId, blockTimestamp, recipients, ctx.splitsRepo, eventPointer);
}

async function verifyGitHubProjectSources(
  recipients: EcosystemRecipient[],
  ctx: HandlerContext,
): Promise<void> {
  const projectRecipients = recipients.filter(
    (recipient): recipient is EcosystemRecipient & { source: z.infer<typeof gitHubSourceSchema> } =>
      'source' in recipient && recipient.source.forge === 'github',
  );

  if (projectRecipients.length === 0) {
    return;
  }

  await verifyProjectSources(
    projectRecipients.map((r) => ({
      accountId: r.accountId,
      source: r.source,
    })),
    ctx.contracts,
  );
}

async function updateEcosystemMainAccount(
  metadata: EcosystemMainAccountMetadata,
  cId: string,
  accountId: string,
  blockNumber: bigint,
  ctx: HandlerContext,
  eventPointer: EventPointer,
): Promise<void> {
  const isVisible =
    blockNumber > ctx.visibilityThresholdBlockNumber && 'isVisible' in metadata
      ? metadata.isVisible
      : true;

  // Update existing ecosystem metadata.
  const updates = {
    account_id: accountId,
    name: metadata.name,
    is_visible: isVisible,
    last_processed_ipfs_hash: cId,
    avatar: metadata.avatar.emoji,
    color: metadata.color,
  };

  const updateResult = await ctx.ecosystemsRepo.updateEcosystemMainAccount(updates, eventPointer);

  if (updateResult.success) {
    logger.info('ecosystem_main_account_updated', { ecosystem: updateResult.data });
    return;
  }

  // Atomically migrate from _pending_nft_transfers to ecosystem_main_accounts if pending data exists.
  const migrationResult = await ctx.pendingNftTransfersRepo.migratePendingToEcosystem(
    accountId,
    isVisible,
    cId,
    metadata.avatar.emoji,
    metadata.color,
    eventPointer,
  );

  if (!migrationResult.wasMigrated) {
    throw new Error(
      `Failed to update ecosystem ${accountId}: ecosystem not found in pending transfers or ecosystem_main_accounts table`,
    );
  }

  logger.info('ecosystem_created_from_pending', {
    accountId,
    blockNumber,
    ecosystem: migrationResult.ecosystem,
  });

  // Update the newly created ecosystem with metadata fields.
  const secondUpdateResult = await ctx.ecosystemsRepo.updateEcosystemMainAccount(
    updates,
    eventPointer,
  );

  if (!secondUpdateResult.success) {
    throw new Error(`Failed to update ecosystem metadata after migration: ${accountId}`);
  }

  logger.info('ecosystem_main_account_updated', { ecosystem: secondUpdateResult.data });
}

async function updateEcosystemSplits(
  accountId: string,
  blockTimestamp: Date,
  recipients: EcosystemRecipient[],
  splitsRepository: SplitsRepository,
  eventPointer: EventPointer,
): Promise<void> {
  const splits: SplitReceiverInput[] = [];

  for (const recipient of recipients) {
    const receiverAccountType = mapToAccountType(recipient.accountId);
    const metadataType = getReceiverTypeFromMetadata(recipient);

    if (metadataType !== receiverAccountType) {
      throw new Error(
        `Receiver type mismatch for account ID ${recipient.accountId}: derived type ${receiverAccountType}, metadata claimed type ${metadataType}`,
      );
    }

    assertValidReceiverType('ecosystem_main_account', receiverAccountType);

    if (receiverAccountType === 'sub_list') {
      splits.push({
        sender_account_id: accountId,
        sender_account_type: 'ecosystem_main_account',
        receiver_account_id: recipient.accountId,
        receiver_account_type: 'sub_list',
        relationship_type: 'sub_list_link',
        weight: recipient.weight,
        block_timestamp: blockTimestamp,
      });
    } else {
      splits.push({
        sender_account_id: accountId,
        sender_account_type: 'ecosystem_main_account',
        receiver_account_id: recipient.accountId,
        receiver_account_type: 'project',
        relationship_type: 'ecosystem_receiver',
        weight: recipient.weight,
        block_timestamp: blockTimestamp,
      });
    }
  }

  const { newSplits } = await splitsRepository.replaceSplitsForSender(
    accountId,
    splits,
    eventPointer,
  );

  logger.info('ecosystem_splits_updated', { accountId, splits: newSplits });
}
