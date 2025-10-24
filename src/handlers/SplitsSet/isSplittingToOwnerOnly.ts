import type { Contracts } from '../../services/Contracts.js';

type SplitsReceiver = {
  accountId: bigint;
  weight: number;
};

/**
 * Validates that ORCID account splits configuration is correct.
 * For ORCID accounts, splits must contain exactly one receiver (the owner) with 100% weight.
 */
export async function isSplittingToOwnerOnly(
  expectedOwnerAccountId: string,
  onChainSplitsHash: `0x${string}`,
  dripsContract: Contracts['drips'],
): Promise<boolean> {
  // Create the expected split receiver configuration (100% to owner).
  const ownerReceiver: SplitsReceiver[] = [
    {
      accountId: BigInt(expectedOwnerAccountId),
      weight: 1_000_000, // 100% in Drips weight format.
    },
  ] as const;

  const expectedHash = await dripsContract.read.hashSplits([ownerReceiver]);

  const isSplitValid = onChainSplitsHash === expectedHash;

  return isSplitValid;
}
