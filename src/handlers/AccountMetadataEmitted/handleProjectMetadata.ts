import type z from 'zod';

import type { gitHubSourceSchema } from '../../metadata/schemas/common/sources.js';
import type { SplitsRepository, SplitReceiverInput } from '../../repositories/SplitsRepository.js';
import { verifyProjectSources } from '../../utils/verifyProjectSources.js';
import type { ProjectMetadata } from '../../services/MetadataService.js';
import { mapToAccountType } from '../../utils/mapToAccountType.js';
import type { HandlerContext } from '../EventHandler.js';
import { logger } from '../../logger.js';
import type { EventPointer } from '../../repositories/types.js';
import { assertValidReceiverType } from '../../utils/splitRules.js';
import { validateSplits } from '../../utils/validateSplits.js';
import { ensureProjectReceivers } from '../../utils/ensureProjectReceivers.js';
import { findOne, update } from '../../db/db.js';
import { projectSchema, type Project } from '../../db/schemas.js';
import { calculateProjectVerificationStatus } from '../../utils/calculateProjectVerificationStatus.js';

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

  // Order matters!
  // Transaction safety is guaranteed by EventProcessor.processBatch() wrapping all handlers in BEGIN/COMMIT.

  const projectSplits = metadata.splits.dependencies.filter(
    (dep) => 'source' in dep && dep.source.forge === 'github',
  ) as { accountId: string; source: z.infer<typeof gitHubSourceSchema> }[];
  await verifyProjectSources(
    [...projectSplits, { accountId: projectId, source: metadata.source }],
    ctx.contracts,
  );
  await ensureProjectReceivers(projectSplits, ctx.client, ctx.schema, eventPointer);
  await updateProjectSplits(projectId, blockTimestamp, metadata, ctx.splitsRepo, eventPointer);
  await updateProject(metadata, cId, ctx, projectId, eventPointer);
}

async function updateProject(
  metadata: ProjectMetadata,
  cId: string,
  ctx: HandlerContext,
  projectId: string,
  eventPointer: EventPointer,
) {
  const { areSplitsValid } = await validateSplits(projectId, ctx.splitsRepo, ctx.contracts);

  const project = await findOne<Project>({
    client: ctx.client,
    table: `${ctx.schema}.projects`,
    where: { account_id: projectId },
    schema: projectSchema,
  });
  if (!project) {
    throw new Error(`Project not found for account_id: ${projectId}`);
  }

  if (project.url !== metadata.source.url) {
    throw new Error(
      `Project URL mismatch: existing URL ${project.url} does not match metadata URL ${metadata.source.url}`,
    );
  }

  const updates: {
    url: string;
    forge: 'github';
    color: string;
    last_processed_ipfs_hash: string;
    is_valid: boolean;
    is_visible?: boolean;
    emoji?: string | null;
    avatar_cid?: string | null;
  } = {
    url: metadata.source.url,
    forge: metadata.source.forge,
    color: metadata.color,
    last_processed_ipfs_hash: cId,
    is_valid: areSplitsValid,
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

  const verification_status = calculateProjectVerificationStatus(
    project.owner_address,
    project.owner_account_id,
    cId,
  );

  const result = await update<Project>({
    client: ctx.client,
    table: `${ctx.schema}.projects`,
    data: {
      account_id: projectId,
      ...updates,
      verification_status,
      last_event_block: eventPointer.last_event_block,
      last_event_tx_index: eventPointer.last_event_tx_index,
      last_event_log_index: eventPointer.last_event_log_index,
    },
    whereColumns: ['account_id'],
    updateColumns: [
      ...Object.keys(updates),
      'verification_status',
      'last_event_block',
      'last_event_tx_index',
      'last_event_log_index',
    ] as Array<keyof Project>,
  });

  if (result.rows.length === 0) {
    throw new Error(`Project not found for account_id: ${projectId}`);
  }

  const updatedProject = projectSchema.parse(result.rows[0]);
  logger.info('project_metadata_updated', { project: updatedProject });
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

    assertValidReceiverType('project', receiverAccountType);

    splits.push({
      sender_account_id: projectId,
      sender_account_type: 'project',
      receiver_account_id: dependency.accountId,
      receiver_account_type: receiverAccountType,
      relationship_type: 'project_dependency',
      weight: dependency.weight,
      block_timestamp: blockTimestamp,
    });
  }

  const { newSplits } = await splitsRepository.replaceSplitsForSender(
    projectId,
    splits,
    eventPointer,
  );

  logger.info('project_splits_updated', { projectId, splits: newSplits });
}
