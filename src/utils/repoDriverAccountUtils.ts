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
 * Extracts the forge ID from a RepoDriver account ID.
 */
function extractForgeFromAccountId(accountId: string) {
  const accountIdAsBigInt = BigInt(accountId);
  // Extract forgeId from bits 216-223 (8 bits after the 32-bit driver ID)
  const forgeId = (accountIdAsBigInt >> 216n) & 0xffn;
  return Number(forgeId);
}

/**
 * Checks if the given account ID represents an ORCID account.
 */
export function isOrcidAccount(accountId: string): boolean {
  // ForgeId for ORCID in account IDs. Value is 4 (not 2 like Forge.ORCID enum)
  //because forgeId encodes both forge type and name length: 0,1=GitHub, 2,3=GitLab, 4=ORCID.
  const ORCID_FORGE_ID = 4;

  return isRepoDriverId(accountId) && extractForgeFromAccountId(accountId) === ORCID_FORGE_ID;
}

/**
 * Checks if the given account ID represents a GitHub project.
 */
export function isProject(accountId: string): boolean {
  // ForgeId for GitHub in account IDs. Value is 0 or 1 depending on name length.
  const GITHUB_FORGE_IDS = [0, 1];

  return (
    isRepoDriverId(accountId) && GITHUB_FORGE_IDS.includes(extractForgeFromAccountId(accountId))
  );
}
