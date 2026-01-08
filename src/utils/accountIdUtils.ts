import { isAddress } from 'viem';

import { logger } from '../logger.js';

import { getContractNameFromAccountId } from './getContractNameFromAccountId.js';

/**
 * Attempts to convert a value to a valid AccountId string.
 * Returns null if the value cannot be converted (not a valid AccountId).
 *
 * This is a "try" variant that never throws - failures are silent.
 * Used for automatic extraction from event args where not all values are AccountIds.
 */
export function tryConvertToAccountId(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  // Skip Ethereum addresses
  if (typeof value === 'string' && isAddress(value)) {
    return null;
  }

  // Convert to string representation
  let idStr: string;
  if (typeof value === 'bigint') {
    idStr = value.toString();
  } else if (typeof value === 'string') {
    idStr = value;
  } else if (typeof value === 'number') {
    idStr = value.toString();
  } else {
    return null;
  }

  // Validate it belongs to a known driver
  try {
    getContractNameFromAccountId(idStr);
    return idStr;
  } catch (error) {
    // Log unknown driver errors as they may indicate a new driver type not yet supported
    if (error instanceof Error && error.message.includes('Unknown driver')) {
      logger.warn('unrecognized_account_id_driver', { value: idStr });
    }
    return null;
  }
}

/**
 * Extracts all valid AccountIds from an event args object.
 */
export function extractAccountIdsFromArgs(args: Record<string, unknown>): string[] {
  const accountIds = new Set<string>();

  for (const value of Object.values(args)) {
    const accountId = tryConvertToAccountId(value);
    if (accountId !== null) {
      accountIds.add(accountId);
    }
  }

  return Array.from(accountIds);
}
