import crypto from 'crypto';

/**
 * Generates a stable 64-bit signed integer lock ID for PostgreSQL advisory locks.
 * Uses deterministic hashing to avoid collisions while remaining stable across restarts.
 */
export function getLockId(schema: string, chainId: string, lockType: string): bigint {
  const key = `${schema}:${chainId}:${lockType}`;
  const hash = crypto.createHash('sha256').update(key).digest();
  return hash.readBigInt64BE(0);
}

/**
 * Get reorg coordination lock ID.
 */
export function getReorgLockId(schema: string, chainId: string): bigint {
  return getLockId(schema, chainId, 'reorg');
}
