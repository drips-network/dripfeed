import type { Pool, PoolClient } from 'pg';

import { logger } from '../logger.js';
import { getLockId } from '../utils/advisoryLock.js';
import { sleep } from '../utils/sleep.js';

/**
 * Manages PostgreSQL advisory locks for single-indexer execution.
 */
export class LockManager {
  private readonly _pool: Pool;
  private readonly _schema: string;
  private readonly _chainId: string;
  private _lockConn: PoolClient | null = null;

  constructor(pool: Pool, schema: string, chainId: string) {
    this._pool = pool;
    this._schema = schema;
    this._chainId = chainId;
  }

  /**
   * Acquires PostgreSQL advisory lock to ensure single-indexer execution per chain.
   */
  async acquire(): Promise<void> {
    const lockId = this._createLockId();
    const maxAttempts = 5; // Initial attempt + 4 retries for deployment handoff.
    const retryDelayMs = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const lockConn = await this._pool.connect();

      try {
        const { rows } = await lockConn.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock($1) as acquired',
          [lockId],
        );
        const acquired = rows[0]?.acquired ?? false;

        if (acquired) {
          this._lockConn = lockConn;
          logger.info('✓ Lock acquired: ready to index\n');
          return;
        }

        lockConn.release();

        if (attempt < maxAttempts) {
          logger.warn('lock_busy_retrying', {
            attempt,
            retryInMs: retryDelayMs,
            chain: this._chainId,
            schema: this._schema,
          });
          await sleep(retryDelayMs);
        }
      } catch (error) {
        if (this._lockConn === null) {
          lockConn.release();
        }
        throw error;
      }
    }

    throw new Error(
      `Another indexer is already running for chain=${this._chainId} schema=${this._schema}. Cannot acquire advisory lock.`,
    );
  }

  /**
   * Releases PostgreSQL advisory lock if held.
   */
  async release(): Promise<void> {
    if (!this._lockConn) {
      return;
    }

    const lockConn = this._lockConn;
    this._lockConn = null;

    const lockId = this._createLockId();
    try {
      await lockConn.query('SELECT pg_advisory_unlock($1)', [lockId]);
    } finally {
      lockConn.release();
    }

    logger.info('lock_released', {
      schema: this._schema,
      chain: this._chainId,
    });
  }

  /**
   * Generates a unique lock identifier based on the schema and chain ID.
   */
  private _createLockId(): bigint {
    return getLockId(this._schema, this._chainId, 'indexer');
  }
}
