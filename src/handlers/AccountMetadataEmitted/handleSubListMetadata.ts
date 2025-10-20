import type z from 'zod';

import type { HandlerContext } from '../EventHandler.js';
import type { gitHubSourceSchema } from '../../metadata/schemas/common/sources.js';
import type { SplitsRepository, SplitReceiverInput } from '../../repositories/SplitsRepository.js';
import type { SubListMetadata } from '../../services/MetadataService.js';
import { logger } from '../../logger.js';
import { verifyProjectSources } from '../../utils/verifyProjectSources.js';
import { mapToAccountType } from '../../utils/mapToAccountType.js';
import type { AccountType } from '../../utils/splitRules.js';
import type { EventPointer } from '../../repositories/types.js';

type SubListRecipient = SubListMetadata['recipients'][number];

export async function handleSubListMetadata(
  accountId: string,
  blockTimestamp: Date,
  _blockNumber: bigint,
  cId: string,
  ctx: HandlerContext,
  eventPointer: EventPointer,
): Promise<void> {
  const metadata = await ctx.metadataService.getImmutableSplitsDriverMetadata(cId);

  if (metadata.parent.type !== 'ecosystem' || metadata.root.type !== 'ecosystem') {
    logger.warn('sub_list_metadata_skipped_invalid_parent_or_root', {
      accountId,
      parentType: metadata.parent.type,
      rootType: metadata.root.type,
      message: 'parent and root must be of type ecosystem',
    });
    return;
  }

  const recipients = metadata.recipients;

  await verifyGitHubProjectSources(recipients, ctx);
  await validateRootAndParentExist(metadata, ctx);
  await updateSubList(metadata, cId, accountId, ctx, eventPointer);
  await updateSubListSplits(accountId, blockTimestamp, recipients, ctx.splitsRepo, eventPointer);
}

async function verifyGitHubProjectSources(
  recipients: SubListRecipient[],
  ctx: HandlerContext,
): Promise<void> {
  const projectRecipients = recipients.filter(
    (recipient): recipient is SubListRecipient & { source: z.infer<typeof gitHubSourceSchema> } =>
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

async function validateRootAndParentExist(
  metadata: SubListMetadata,
  ctx: HandlerContext,
): Promise<void> {
  const parent = await ctx.ecosystemsRepo.getEcosystemMainAccount(metadata.parent.accountId);

  if (!parent) {
    throw new Error(`Parent Ecosystem Main Account '${metadata.parent.accountId}' not found`);
  }

  const root = await ctx.ecosystemsRepo.getEcosystemMainAccount(metadata.root.accountId);

  if (!root) {
    throw new Error(`Root Ecosystem Main Account '${metadata.root.accountId}' not found`);
  }
}

async function updateSubList(
  metadata: SubListMetadata,
  cId: string,
  accountId: string,
  ctx: HandlerContext,
  eventPointer: EventPointer,
): Promise<void> {
  const isVisible =
    'isVisible' in metadata && metadata.isVisible !== undefined ? metadata.isVisible : true;

  const parentAccountType = getAccountTypeFromMetadata(metadata.parent.type);
  const rootAccountType = getAccountTypeFromMetadata(metadata.root.type);

  const subList = await ctx.subListsRepo.upsertSubList({
    account_id: accountId,
    is_valid: false,
    parent_account_id: metadata.parent.accountId,
    parent_account_type: parentAccountType,
    root_account_id: metadata.root.accountId,
    root_account_type: rootAccountType,
    is_visible: isVisible,
    last_processed_ipfs_hash: cId,
  }, eventPointer);

  logger.info('sub_list_updated', { subList });
}

async function updateSubListSplits(
  accountId: string,
  blockTimestamp: Date,
  recipients: SubListRecipient[],
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

    const relationshipType =
      receiverAccountType === 'sub_list' ? 'sub_list_link' : 'sub_list_receiver';

    splits.push({
      sender_account_id: accountId,
      sender_account_type: 'sub_list',
      receiver_account_id: recipient.accountId,
      receiver_account_type: receiverAccountType,
      relationship_type: relationshipType,
      weight: recipient.weight,
      block_timestamp: blockTimestamp,
    });
  }

  const { newSplits } = await splitsRepository.replaceSplitsForSender(accountId, splits, eventPointer);

  logger.info('sub_list_splits_updated', { accountId, splits: newSplits });
}

function getReceiverTypeFromMetadata(recipient: SubListRecipient): AccountType {
  if (!('type' in recipient)) {
    return 'address';
  }

  switch (recipient.type) {
    case 'address':
      return 'address';
    case 'repoSubAccountDriver':
      if (
        'source' in recipient &&
        'forge' in recipient.source &&
        recipient.source.forge === 'orcid'
      ) {
        return 'linked_identity';
      }
      return 'project';
    case 'dripList':
      return 'drip_list';
    case 'subList':
      return 'sub_list';
    case 'deadline':
      return 'deadline';
    default:
      throw new Error(`Unknown receiver type: ${(recipient as any).type}`); // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}

function getAccountTypeFromMetadata(type: 'dripList' | 'ecosystem' | 'subList'): AccountType {
  switch (type) {
    case 'dripList':
      return 'drip_list';
    case 'ecosystem':
      return 'ecosystem_main_account';
    case 'subList':
      return 'sub_list';
    default:
      throw new Error(`Unknown account type from metadata: ${type}`);
  }
}
