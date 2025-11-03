import type { ProjectStatus } from '../db/schemas.js';

/**
 * Calculate verification status.
 *
 * Invariant: owner_address and owner_account_id must both exist or both be null.
 * Empty strings are treated as missing values.
 */
export function calculateProjectVerificationStatus(
  ownerAddress: string | null,
  ownerAccountId: string | null,
  ipfsHash: string | null,
): ProjectStatus {
  const hasOwnerAddress = Boolean(ownerAddress);
  const hasOwnerAccountId = Boolean(ownerAccountId);
  const hasIpfsHash = Boolean(ipfsHash);

  if (hasOwnerAddress !== hasOwnerAccountId) {
    throw new Error(
      `Invariant violation: owner_address and owner_account_id must both exist or both be null. ` +
        `Got owner_address=${ownerAddress}, owner_account_id=${ownerAccountId}`,
    );
  }

  if (hasOwnerAddress) {
    return hasIpfsHash ? 'claimed' : 'pending_metadata';
  }

  return 'unclaimed';
}
