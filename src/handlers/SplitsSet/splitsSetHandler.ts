import { type DecodeEventLogReturnType } from 'viem';

import type { DripsAbi } from '../../chains/abis/abiTypes.js';
import { logger } from '../../logger.js';
import { isOrcidAccount, isProject } from '../../utils/repoDriverAccountUtils.js';
import { isNftDriverId } from '../../utils/ntfDriverAccountIdUtils.js';
import { isImmutableSplitsDriverId } from '../../utils/immutableSplitsDriverUtils.js';
import { toEventPointer } from '../../repositories/types.js';
import { unreachable } from '../../utils/unreachable.js';
import type { EventHandler, HandlerEvent } from '../EventHandler.js';

import { isSplittingToOwnerOnly } from './isSplittingToOwnerOnly.js';

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
    contracts,
  } = ctx;

  // "Unsafe" call is acceptable here for "valid NOW" semantics:
  // - Non-deterministic: same historic event may produce different results if reprocessed later
  // - Eventual consistency: after catch-up, only the latest SplitsSet has is_valid=true
  // - Acceptable staleness: RPC query may lag 1-2 blocks behind chain tip
  // This trade-off is intentional to validate current on-chain state, not historic state.
  const onChainSplits = await contracts.drips.read.splitsHash([accountId]);

  const isCurrentOnChain = onChainSplits === receiversHash;
  const accountIdStr = accountId.toString();
  const eventPointer = toEventPointer(event);

  if (isOrcidAccount(accountIdStr)) {
    const linkedIdentity = await linkedIdentitiesRepo.getLinkedIdentity(accountIdStr);
    if (!linkedIdentity || !linkedIdentity.owner_account_id) {
      unreachable(
        `ORCID with account ID ${accountIdStr} not found or has no owner while processing splits but was expected to exist`,
      );
    }

    const areSplitsValid =
      isCurrentOnChain &&
      (await isSplittingToOwnerOnly(
        linkedIdentity.owner_account_id,
        onChainSplits,
        contracts.drips,
      ));

    const result = await linkedIdentitiesRepo.updateLinkedIdentity(
      {
        account_id: accountIdStr,
        are_splits_valid: areSplitsValid,
      },
      eventPointer,
    );

    if (!result.success) {
      unreachable(
        `ORCID with account ID ${accountIdStr} not found while processing splits but was previously found`,
      );
    }

    logger.info('orcid_splits_validity_updated', {
      accountId: accountIdStr,
      splitsHash: receiversHash,
      isCurrentOnChain,
      areSplitsValid,
      ownerAccountId: linkedIdentity.owner_account_id,
      identityType: result.data.identity_type,
    });

    return;
  } else if (isProject(accountIdStr)) {
    const result = await projectsRepo.updateProject(
      {
        account_id: accountIdStr,
        is_valid: isCurrentOnChain,
      },
      eventPointer,
    );

    if (!result.success) {
      unreachable(
        `Project with account ID ${accountIdStr} not found while processing splits but it was expected to exist`,
      );
    }

    logger.info('project_splits_validity_updated', {
      accountId: accountIdStr,
      splitsHash: receiversHash,
      isValid: isCurrentOnChain,
      projectName: result.data.name,
    });

    return;
  } else if (isNftDriverId(accountIdStr)) {
    const dripListResult = await dripListsRepo.updateDripList(
      {
        account_id: accountIdStr,
        is_valid: isCurrentOnChain,
      },
      eventPointer,
    );

    if (dripListResult.success) {
      logger.info('drip_list_splits_validity_updated', {
        accountId: accountIdStr,
        splitsHash: receiversHash,
        isValid: isCurrentOnChain,
        dripListName: dripListResult.data.name,
      });

      return;
    }

    const ecosystemResult = await ecosystemsRepo.updateEcosystemMainAccount(
      {
        account_id: accountIdStr,
        is_valid: isCurrentOnChain,
      },
      eventPointer,
    );

    if (ecosystemResult.success) {
      logger.info('ecosystem_splits_validity_updated', {
        accountId: accountIdStr,
        splitsHash: receiversHash,
        isValid: isCurrentOnChain,
      });

      return;
    }

    unreachable(
      `No drip list or ecosystem found for NFT Driver account ID ${accountIdStr} while processing splits but was expected to exist`,
    );
  } else if (isImmutableSplitsDriverId(accountIdStr)) {
    const subListResult = await subListsRepo.updateSubList(
      {
        account_id: accountIdStr,
        is_valid: isCurrentOnChain,
      },
      eventPointer,
    );

    if (subListResult.success) {
      logger.info('sub_list_splits_validity_updated', {
        accountId: accountIdStr,
        splitsHash: receiversHash,
        isValid: isCurrentOnChain,
      });

      return;
    }

    unreachable(
      `No sub list found for Immutable Splits Driver account ID ${accountIdStr} while processing splits but was expected to exist`,
    );
  } else {
    logger.warn('unsupported_splits_set_account_type', { accountId: accountIdStr });
  }
};
