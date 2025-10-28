import type z from 'zod';

import type { HandlerContext } from '../EventHandler.js';
import type { gitHubSourceSchema } from '../../metadata/schemas/common/sources.js';
import type { SplitsRepository, SplitReceiverInput } from '../../repositories/SplitsRepository.js';
import type { SubListMetadata } from '../../services/MetadataService.js';
import { logger } from '../../logger.js';
import { verifyProjectSources } from '../../utils/verifyProjectSources.js';
import { mapToAccountType } from '../../utils/mapToAccountType.js';
import { getReceiverTypeFromMetadata } from '../../utils/metadataTypeMapping.js';
import { assertValidReceiverType, type AccountType } from '../../utils/splitRules.js';
import type { EventPointer } from '../../repositories/types.js';
import { validateSplits } from '../../utils/validateSplits.js';

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

  // Order matters! Splits must be written before validation.
  // Note: Transaction safety is guaranteed by EventProcessor.processBatch() wrapping all handlers in BEGIN/COMMIT.  await updateSubListSplits(accountId, blockTimestamp, recipients, ctx.splitsRepo, eventPointer);
  await updateSubList(metadata, cId, accountId, ctx, eventPointer);
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
  const parent = await ctx.ecosystemsRepo.findById(metadata.parent.accountId);

  if (!parent) {
    throw new Error(`Parent Ecosystem Main Account '${metadata.parent.accountId}' not found`);
  }

  const root = await ctx.ecosystemsRepo.findById(metadata.root.accountId);

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
  const parentAccountType = getAccountTypeFromMetadata(metadata.parent.type);
  const rootAccountType = getAccountTypeFromMetadata(metadata.root.type);

  const { areSplitsValid } = await validateSplits(accountId, ctx.splitsRepo, ctx.contracts);

  const subList = await ctx.subListsRepo.upsertSubList(
    {
      account_id: accountId,
      is_valid: areSplitsValid,
      parent_account_id: metadata.parent.accountId,
      parent_account_type: parentAccountType,
      root_account_id: metadata.root.accountId,
      root_account_type: rootAccountType,
      last_processed_ipfs_hash: cId,
    },
    eventPointer,
  );

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

    assertValidReceiverType('sub_list', receiverAccountType);

    if (receiverAccountType === 'sub_list') {
      splits.push({
        sender_account_id: accountId,
        sender_account_type: 'sub_list',
        receiver_account_id: recipient.accountId,
        receiver_account_type: 'sub_list',
        relationship_type: 'sub_list_link',
        weight: recipient.weight,
        block_timestamp: blockTimestamp,
      });
    } else {
      splits.push({
        sender_account_id: accountId,
        sender_account_type: 'sub_list',
        receiver_account_id: recipient.accountId,
        receiver_account_type: receiverAccountType,
        relationship_type: 'sub_list_receiver',
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

  logger.info('sub_list_splits_updated', { accountId, splits: newSplits });
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
