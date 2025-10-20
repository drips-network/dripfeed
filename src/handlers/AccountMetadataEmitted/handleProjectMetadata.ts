import type z from 'zod';

import type { gitHubSourceSchema } from '../../metadata/schemas/common/sources.js';
import type { SplitsRepository, SplitReceiverInput } from '../../repositories/SplitsRepository.js';
import { verifyProjectSources } from '../../utils/verifyProjectSources.js';
import type { ProjectMetadata } from '../../services/MetadataService.js';
import { mapToAccountType } from '../../utils/mapToAccountType.js';
import type { HandlerContext } from '../EventHandler.js';
import { logger } from '../../logger.js';
import type { EventPointer } from '../../repositories/types.js';

export async function handleProjectMetadata(
  projectId: string,
  blockTimestamp: Date,
  _blockNumber: bigint,
  cId: string,
  ctx: HandlerContext,
  eventPointer: EventPointer,
): Promise<void> {
  const metadata = await ctx.metadataService.getProjectMetadata(cId);

  if (projectId !== metadata.describes?.accountId) {
    throw new Error(
      `Project ID ${projectId} does not match metadata account ID ${metadata.describes?.accountId}`,
    );
  }

  const projectSplits = metadata.splits.dependencies.filter(
    (dep) => 'source' in dep && dep.source.forge === 'github',
  ) as { accountId: string; source: z.infer<typeof gitHubSourceSchema> }[];

  await verifyProjectSources(
    [...projectSplits, { accountId: projectId, source: metadata.source }],
    ctx.contracts,
  );
  await updateProject(metadata, cId, ctx, projectId, eventPointer);
  await updateProjectSplits(projectId, blockTimestamp, metadata, ctx.splitsRepo, eventPointer);
}

async function updateProject(
  metadata: ProjectMetadata,
  cId: string,
  ctx: HandlerContext,
  projectId: string,
  eventPointer: EventPointer,
) {
  const updates: {
    url: string;
    forge: 'github';
    color: string;
    last_processed_ipfs_hash: string;
    is_visible?: boolean;
    emoji?: string | null;
    avatar_cid?: string | null;
  } = {
    url: metadata.source.url,
    forge: metadata.source.forge,
    color: metadata.color,
    last_processed_ipfs_hash: cId,
  };

  if ('isVisible' in metadata) {
    updates.is_visible = metadata.isVisible;
  }

  if ('avatar' in metadata) {
    if (metadata.avatar.type === 'emoji') {
      updates.emoji = metadata.avatar.emoji;
      updates.avatar_cid = null;
    } else if (metadata.avatar.type === 'image') {
      updates.avatar_cid = metadata.avatar.cid;
      updates.emoji = null;
    }
  } else {
    updates.emoji = metadata.emoji;
  }

  const result = await ctx.projectsRepo.updateProject({
    account_id: projectId,
    ...updates,
  }, eventPointer);

  if (!result.success) {
    throw new Error(`Project not found for account_id: ${projectId}`);
  }

  logger.info('project_metadata_updated', { project: result.data });
}

async function updateProjectSplits(
  projectId: string,
  blockTimestamp: Date,
  metadata: ProjectMetadata,
  splitsRepository: SplitsRepository,
  eventPointer: EventPointer,
): Promise<void> {
  const splits: SplitReceiverInput[] = [];

  for (const maintainer of metadata.splits.maintainers) {
    splits.push({
      sender_account_id: projectId,
      sender_account_type: 'project',
      receiver_account_id: maintainer.accountId,
      receiver_account_type: 'address',
      relationship_type: 'project_maintainer',
      weight: maintainer.weight,
      block_timestamp: blockTimestamp,
    });
  }

  for (const dependency of metadata.splits.dependencies) {
    const receiverAccountType = mapToAccountType(dependency.accountId);

    if (receiverAccountType === 'address') {
      splits.push({
        sender_account_id: projectId,
        sender_account_type: 'project',
        receiver_account_id: dependency.accountId,
        receiver_account_type: 'address',
        relationship_type: 'project_dependency',
        weight: dependency.weight,
        block_timestamp: blockTimestamp,
      });
    } else if (receiverAccountType === 'project') {
      splits.push({
        sender_account_id: projectId,
        sender_account_type: 'project',
        receiver_account_id: dependency.accountId,
        receiver_account_type: 'project',
        relationship_type: 'project_dependency',
        weight: dependency.weight,
        block_timestamp: blockTimestamp,
      });
    } else if (receiverAccountType === 'drip_list') {
      splits.push({
        sender_account_id: projectId,
        sender_account_type: 'project',
        receiver_account_id: dependency.accountId,
        receiver_account_type: 'drip_list',
        relationship_type: 'project_dependency',
        weight: dependency.weight,
        block_timestamp: blockTimestamp,
      });
    } else if (receiverAccountType === 'linked_identity') {
      splits.push({
        sender_account_id: projectId,
        sender_account_type: 'project',
        receiver_account_id: dependency.accountId,
        receiver_account_type: 'linked_identity',
        relationship_type: 'project_dependency',
        weight: dependency.weight,
        block_timestamp: blockTimestamp,
      });
    } else if (receiverAccountType === 'deadline') {
      splits.push({
        sender_account_id: projectId,
        sender_account_type: 'project',
        receiver_account_id: dependency.accountId,
        receiver_account_type: 'deadline',
        relationship_type: 'project_dependency',
        weight: dependency.weight,
        block_timestamp: blockTimestamp,
      });
    } else {
      throw new Error(
        `Invalid receiver type for project dependency: ${receiverAccountType} (account ${dependency.accountId})`,
      );
    }
  }

  const { newSplits } = await splitsRepository.replaceSplitsForSender(projectId, splits, eventPointer);

  logger.info('project_splits_updated', { projectId, splits: newSplits });
}
