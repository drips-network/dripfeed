import { getContractNameFromAccountId } from './getContractNameFromAccountId.js';
import { isOrcidAccount } from './repoDriverAccountUtils.js';
import type { AccountType } from './splitRules.js';

/**
 * Maps an account ID to its account type based on the contract name.
 */
export function mapToAccountType(accountId: string): AccountType {
  const contractName = getContractNameFromAccountId(accountId);

  // Check if it's an ORCID account (special case for repoDriver).
  if (contractName === 'repoDriver' && isOrcidAccount(accountId)) {
    return 'linked_identity';
  }

  switch (contractName) {
    case 'addressDriver':
      return 'address';
    case 'nftDriver':
      return 'drip_list';
    case 'immutableSplitsDriver':
      return 'sub_list';
    case 'repoDriver':
      return 'project';
    case 'repoSubAccountDriver':
      return 'sub_list';
    case 'repoDeadlineDriver':
      return 'deadline';
    default:
      throw new Error(`Unknown contract name for account ID ${accountId}: ${contractName}`);
  }
}
