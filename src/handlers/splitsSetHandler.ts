import { type DecodeEventLogReturnType } from 'viem';

import type { DripsAbi } from '../chain-configs/all-chains.js';
import { logger } from '../logger.js';
import { isOrcidAccount, isProject } from '../utils/repoDriverAccountUtils.js';
import { isNftDriverId } from '../utils/ntfDriverAccountIdUtils.js';
import { isImmutableSplitsDriverId } from '../utils/immutableSplitsDriverUtils.js';
import { toEventPointer } from '../repositories/types.js';

import type { EventHandler, HandlerEvent } from './EventHandler.js';

type SplitsSetEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<DripsAbi, 'SplitsSet'>['args'];
};

export const splitsSetHandler: EventHandler<SplitsSetEvent> = async (event, ctx) => {
  const { accountId, receiversHash } = event.args;
  const {
    projectsRepo,
    linkedIdentitiesRepo,
    dripListsRepo,
    ecosystemsRepo,
    subListsRepo,
    contracts: contracts,
  } = ctx;
  const accountIsStr = accountId.toString();

  const eventPointer = toEventPointer(event);

  // Unsafe call is acceptable here for "valid NOW" semantics:
  // - Non-deterministic: same historic event may produce different results if reprocessed later
  // - Eventual consistency: after catch-up, only the latest SplitsSet has is_valid=true
  // - Acceptable staleness: RPC query may lag 1-2 blocks behind chain tip
  // This trade-off is intentional to validate current on-chain state, not historic state.
  const onChainSplits = await contracts.drips.read.splitsHash([accountId]);

  const isCurrentOnChain = onChainSplits === receiversHash;
  const accountIdStr = accountId.toString();

  if (isOrcidAccount(accountIsStr)) {
    const result = await linkedIdentitiesRepo.updateLinkedIdentity({
      account_id: accountIdStr,
      is_valid: isCurrentOnChain,
      are_splits_valid: isCurrentOnChain,
    }, eventPointer);

    if (!result.success) {
      throw new Error(`Linked identity not found for account_id: ${accountIdStr}`);
    }

    logger.info('linked_identity_splits_validity_updated', {
      accountId: accountIdStr,
      splitsHash: receiversHash,
      isValid: isCurrentOnChain,
      areSplitsValid: isCurrentOnChain,
      identityType: result.data.identity_type,
    });

    return;
  } else if (isProject(accountIsStr)) {
    const result = await projectsRepo.updateProject({
      account_id: accountIdStr,
      is_valid: isCurrentOnChain,
    }, eventPointer);

    if (!result.success) {
      throw new Error(`Project not found for account_id: ${accountIdStr}`);
    }

    logger.info('project_splits_validity_updated', {
      accountId: accountIdStr,
      splitsHash: receiversHash,
      isValid: isCurrentOnChain,
      projectName: result.data.name,
    });

    return;
  } else if (isNftDriverId(accountIsStr)) {
    const dripListResult = await dripListsRepo.updateDripList({
      account_id: accountIdStr,
      is_valid: isCurrentOnChain,
    }, eventPointer);

    if (dripListResult.success) {
      logger.info('drip_list_splits_validity_updated', {
        accountId: accountIdStr,
        splitsHash: receiversHash,
        isValid: isCurrentOnChain,
        dripListName: dripListResult.data.name,
      });

      return;
    }

    const ecosystemResult = await ecosystemsRepo.updateEcosystemMainAccount({
      account_id: accountIdStr,
      is_valid: isCurrentOnChain,
    }, eventPointer);

    if (ecosystemResult.success) {
      logger.info('ecosystem_splits_validity_updated', {
        accountId: accountIdStr,
        splitsHash: receiversHash,
        isValid: isCurrentOnChain,
      });

      return;
    }

    throw new Error(`No drip list or ecosystem found for NFT Driver account ID ${accountId}`);
  } else if (isImmutableSplitsDriverId(accountIsStr)) {
    const subListResult = await subListsRepo.updateSubList({
      account_id: accountIdStr,
      is_valid: isCurrentOnChain,
    }, eventPointer);

    if (subListResult.success) {
      logger.info('sub_list_splits_validity_updated', {
        accountId: accountIdStr,
        splitsHash: receiversHash,
        isValid: isCurrentOnChain,
      });

      return;
    }

    throw new Error(`No sub list found for Immutable Splits Driver account ID ${accountId}`);
  } else {
    logger.warn('unsupported_splits_set_account_type', { accountId: accountIdStr });
  }
};
