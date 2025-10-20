import { logger } from '../logger.js';

import { sleep } from './sleep.js';

/**
 * PostgreSQL error codes that should trigger retry.
 */
const TRANSIENT_PG_ERROR_CODES: Set<string> = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '53000', // insufficient_resources
  '53100', // disk_full
  '53200', // out_of_memory
  '53300', // too_many_connections
  '57P03', // cannot_connect_now
]);

/**
 * Classifies PostgreSQL error as transient or permanent.
 */
export function isTransientDbError(error: unknown): boolean {
  const pgError = error as { code?: string };

  if (!pgError.code) {
    return false;
  }

  // Exact match for known transient codes.
  if (TRANSIENT_PG_ERROR_CODES.has(pgError.code)) {
    return true;
  }

  // Match error code prefixes for connection/resource errors.
  const code = pgError.code;
  return code.startsWith('08') || code.startsWith('53') || code.startsWith('57');
}

/**
 * Retries database operations with exponential backoff for transient errors.
 */
export async function withDbRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (!isTransientDbError(error)) {
        throw error;
      }

      if (attempt < maxRetries - 1) {
        const backoffMs = Math.pow(2, attempt) * 1000 * (0.5 + Math.random());
        logger.warn('db_retrying_transient_error', {
          attempt: attempt + 1,
          maxRetries,
          backoffMs: Math.round(backoffMs),
          error: lastError.message,
        });
        await sleep(backoffMs);
      }
    }
  }

  throw new Error(`Database operation failed after ${maxRetries} attempts: ${lastError?.message}`, {
    cause: lastError,
  });
}
