import { getContractNameFromAccountId } from './getContractNameFromAccountId.js';

export function isRepoDriverId(id: string): boolean {
  const isNaN = Number.isNaN(Number(id));
  const isAccountIdOfRepoDriver = getContractNameFromAccountId(id) === 'repoDriver';

  if (isNaN || !isAccountIdOfRepoDriver) {
    return false;
  }

  return true;
}

/**
 * Extracts the source ID from a RepoDriver account ID.
 *
 * Account ID layout: `driverId (32 bits) | sourceId (7 bits) | isHash (1 bit) | nameEncoded (216 bits)`
 *
 * The 8 bits at positions 216-223 encode `sourceId (7 bits) | isHash (1 bit)`.
 * We shift right by 1 to drop the isHash bit and get the pure sourceId.
 */
function extractSourceIdFromAccountId(accountId: string): number {
  const accountIdAsBigInt = BigInt(accountId);
  const sourceIdAndHash = (accountIdAsBigInt >> 216n) & 0xffn;
  return Number(sourceIdAndHash >> 1n);
}

/**
 * Checks if the given account ID represents an ORCID account.
 */
export function isOrcidAccount(accountId: string): boolean {
  // Source IDs for ORCID: 2 = orcid, 4 = orcidSandbox
  const ORCID_SOURCE_IDS = [2, 4];

  return (
    isRepoDriverId(accountId) && ORCID_SOURCE_IDS.includes(extractSourceIdFromAccountId(accountId))
  );
}

/**
 * Checks if the given account ID represents a GitHub project.
 */
export function isProject(accountId: string): boolean {
  // Source ID 0 = GitHub
  const GITHUB_SOURCE_ID = 0;

  return isRepoDriverId(accountId) && extractSourceIdFromAccountId(accountId) === GITHUB_SOURCE_ID;
}
