import type { Contracts } from '../services/Contracts.js';
import type { SplitsRepository } from '../repositories/SplitsRepository.js';

import { formatSplitReceivers } from './formatSplitReceivers.js';

// WARNING: This function queries current on-chain state (non-deterministic).
// See splitsSetHandler.ts for "unsafe" semantics explanation.
/**
 * Validates whether the splits stored in the database match the *current* on-chain state.
 *
 * @param accountId - The account ID to validate splits for.
 * @param splitsRepo - Repository to fetch split receivers from DB.
 * @param contracts - Contract instances for querying on-chain state.
 * @returns Object containing the DB hash, on-chain hash, and whether they match.
 */
export async function validateSplits(
  accountId: string,
  splitsRepo: SplitsRepository,
  contracts: Contracts,
): Promise<{
  dbSplitsHash: `0x${string}`;
  onChainCurrentSplitsHash: `0x${string}`;
  areSplitsValid: boolean;
}> {
  const dbSplitsHash = await calculateDbSplitsHash(accountId, splitsRepo, contracts);
  const onChainCurrentSplitsHash = await contracts.drips.read.splitsHash([BigInt(accountId)]);
  const areSplitsValid = dbSplitsHash === onChainCurrentSplitsHash;

  return {
    dbSplitsHash,
    onChainCurrentSplitsHash,
    areSplitsValid,
  };
}

/**
 * Calculates the hash of splits stored in the database for a given account ID.
 *
 * @param accountId - The account ID sending splits.
 * @param splitsRepo - Repository to fetch split receivers.
 * @param contracts - Contract instances for hashing.
 * @returns The hash of the DB splits, matching on-chain format.
 */
export async function calculateDbSplitsHash(
  accountId: string,
  splitsRepo: SplitsRepository,
  contracts: Contracts,
): Promise<`0x${string}`> {
  const dbSplits = await splitsRepo.getCurrentSplitReceiversBySender(accountId);

  // TODO: N+1 RPC issue - each sub-account split makes individual calcAccountId call.
  // Consider using multicall to batch these requests into a single RPC call.
  const receivers = await Promise.all(
    dbSplits.map(async (split) => {
      let receiverId = split.receiver_account_id;

      if (split.splits_to_repo_driver_sub_account) {
        const subAccountId = await contracts.repoSubAccountDriver.read.calcAccountId([
          BigInt(split.receiver_account_id),
        ]);
        receiverId = subAccountId.toString();
      }

      return {
        accountId: BigInt(receiverId),
        weight: split.weight,
      };
    }),
  );

  const hash = await contracts.drips.read.hashSplits([formatSplitReceivers(receivers)]);
  return hash;
}
