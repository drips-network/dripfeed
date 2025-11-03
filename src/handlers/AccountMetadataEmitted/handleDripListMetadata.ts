import type z from 'zod';

import type { gitHubSourceSchema } from '../../metadata/schemas/common/sources.js';
import type { SplitsRepository, SplitReceiverInput } from '../../repositories/SplitsRepository.js';
import type { HandlerContext } from '../EventHandler.js';
import type { DripListMetadata } from '../../services/MetadataService.js';
import { verifyProjectSources } from '../../utils/verifyProjectSources.js';
import { logger } from '../../logger.js';
import { mapToAccountType } from '../../utils/mapToAccountType.js';
import { getReceiverTypeFromMetadata } from '../../utils/metadataTypeMapping.js';
import { assertValidReceiverType } from '../../utils/splitRules.js';
import type { EventPointer } from '../../repositories/types.js';
import { validateSplits } from '../../utils/validateSplits.js';
import { ensureProjectReceivers } from '../../utils/ensureProjectReceivers.js';

type DripListReceiver = Extract<
  DripListMetadata,
  { type: 'dripList'; recipients: unknown }
>['recipients'][number];

type LegacyDripListReceiver = Extract<DripListMetadata, { projects: unknown }>['projects'][number];

type Receiver = DripListReceiver | LegacyDripListReceiver;

export async function handleDripListMetadata(
  dripListId: string,
  blockTimestamp: Date,
  blockNumber: bigint,
  cId: string,
  metadata: DripListMetadata,
  ctx: HandlerContext,
  eventPointer: EventPointer,
): Promise<void> {
  if (dripListId !== metadata.describes?.accountId) {
    throw new Error(
      `Drip List ID ${dripListId} does not match metadata account ID ${metadata.describes?.accountId}`,
    );
  }

  // Order matters!
  // Transaction safety is guaranteed by EventProcessor.processBatch() wrapping all handlers in BEGIN/COMMIT.

  const splits = extractReceivers(metadata);
  const projectReceivers = await verifyGitHubProjectSources(splits, ctx);
  await ensureProjectReceivers(projectReceivers, ctx.client, ctx.schema, eventPointer);
  await updateDripListSplits(
    dripListId.toString(),
    blockTimestamp,
    splits,
    ctx.splitsRepo,
    eventPointer,
  );
  await updateDripList(metadata, cId, dripListId, blockNumber, ctx, eventPointer);
}

function extractReceivers(metadata: DripListMetadata): Receiver[] {
  if ('type' in metadata && metadata.type === 'dripList') {
    return metadata.recipients ?? [];
  }

  if ('projects' in metadata) {
    return metadata.projects ?? [];
  }

  return [];
}

async function verifyGitHubProjectSources(
  receivers: Receiver[],
  ctx: HandlerContext,
): Promise<(Receiver & { source: z.infer<typeof gitHubSourceSchema> })[]> {
  const projectSplits = receivers.filter(
    (receiver): receiver is Receiver & { source: z.infer<typeof gitHubSourceSchema> } =>
      'source' in receiver && receiver.source.forge === 'github',
  );

  if (projectSplits.length === 0) {
    return [];
  }

  await verifyProjectSources(
    projectSplits.map((r) => ({
      accountId: r.accountId,
      source: r.source,
    })),
    ctx.contracts,
  );

  return projectSplits;
}

async function updateDripList(
  metadata: DripListMetadata,
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

  const { areSplitsValid } = await validateSplits(accountId, ctx.splitsRepo, ctx.contracts);

  // Update existing drip list metadata.
  const updates = {
    account_id: accountId,
    name: metadata.name,
    description: 'description' in metadata ? metadata.description || null : null,
    latest_voting_round_id:
      'latestVotingRoundId' in metadata ? metadata.latestVotingRoundId || null : null,
    last_processed_ipfs_hash: cId,
    is_visible: isVisible,
    is_valid: areSplitsValid,
  };

  const updateResult = await ctx.dripListsRepo.updateDripList(updates, eventPointer);

  if (updateResult.success) {
    logger.info('drip_list_updated', { dripList: updateResult.data });
    return;
  }

  // Atomically migrate from _pending_nft_transfers to drip_lists if pending data exists.
  const migrationResult = await ctx.pendingNftTransfersRepo.migratePendingToDripList(
    accountId,
    isVisible,
    eventPointer,
  );

  if (!migrationResult.wasMigrated) {
    throw new Error(
      `Failed to update drip list ${accountId}: drip list not found in pending transfers or drip_lists table`,
    );
  }

  logger.info('drip_list_created_from_pending', {
    accountId,
    blockNumber,
    dripList: migrationResult.dripList,
  });

  // Update the newly created drip list with metadata fields.
  const secondUpdateResult = await ctx.dripListsRepo.updateDripList(updates, eventPointer);

  if (!secondUpdateResult.success) {
    throw new Error(`Failed to update drip list metadata after migration: ${accountId}`);
  }

  logger.info('drip_list_updated', { dripList: secondUpdateResult.data });
}

async function updateDripListSplits(
  accountId: string,
  blockTimestamp: Date,
  receivers: Receiver[],
  splitsRepository: SplitsRepository,
  eventPointer: EventPointer,
): Promise<void> {
  const splits: SplitReceiverInput[] = [];

  for (const receiver of receivers) {
    const receiverAccountType = mapToAccountType(receiver.accountId);
    const metadataType = getReceiverTypeFromMetadata(receiver);

    if (metadataType !== receiverAccountType) {
      throw new Error(
        `Receiver type mismatch for account ID ${receiver.accountId}: derived type ${receiverAccountType}, metadata claimed type ${metadataType}`,
      );
    }

    assertValidReceiverType('drip_list', receiverAccountType);

    splits.push({
      sender_account_id: accountId,
      sender_account_type: 'drip_list',
      receiver_account_id: receiver.accountId,
      receiver_account_type: receiverAccountType,
      relationship_type: 'drip_list_receiver',
      weight: receiver.weight,
      block_timestamp: blockTimestamp,
    });
  }

  const { newSplits } = await splitsRepository.replaceSplitsForSender(
    accountId,
    splits,
    eventPointer,
  );

  logger.info('drip_list_splits_updated', { accountId, splits: newSplits });
}
