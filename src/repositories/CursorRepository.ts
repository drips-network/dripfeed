import type { Pool, PoolClient } from 'pg';

import { validateSchemaName } from '../utils/sqlValidation.js';

/**
 * Tracks the indexing progress for a blockchain.
 */
export type Cursor = {
  chainId: string;
  /** Latest block number fetched and scanned for events. */
  fetchedToBlock: bigint;
  updatedAt: Date;
};

type CursorRow = {
  chain_id: string;
  fetched_to_block: string | number | bigint;
  updated_at: Date;
};

export class CursorRepository {
  private readonly _schema: string;

  public readonly _chainId: string;

  constructor(schema: string, chainId: string) {
    this._schema = validateSchemaName(schema);

    if (!chainId || typeof chainId !== 'string' || chainId.trim() === '') {
      throw new Error('Chain ID must be a non-empty string.');
    }
    this._chainId = chainId.trim();
  }

  /**
   * Retrieves the cursor for the current chain.
   */
  async getCursor(pool: Pool): Promise<Cursor | null> {
    const result = await pool.query(`SELECT * FROM ${this._schema}._cursor WHERE chain_id = $1`, [
      this._chainId,
    ]);
    return result.rows[0] ? this._rowToCursor(result.rows[0]) : null;
  }

  /**
   * Retrieves the cursor within a transaction (without lock).
   */
  async getCursorInTransaction(tx: PoolClient): Promise<Cursor | null> {
    const result = await tx.query(`SELECT * FROM ${this._schema}._cursor WHERE chain_id = $1`, [
      this._chainId,
    ]);
    return result.rows[0] ? this._rowToCursor(result.rows[0]) : null;
  }

  /**
   * Retrieves the cursor with FOR UPDATE lock within a transaction.
   */
  async getCursorForUpdate(tx: PoolClient): Promise<Cursor | null> {
    // FOR UPDATE serializes cursor modifications.
    const result = await tx.query(
      `SELECT * FROM ${this._schema}._cursor WHERE chain_id = $1 FOR UPDATE`,
      [this._chainId],
    );
    return result.rows[0] ? this._rowToCursor(result.rows[0]) : null;
  }

  /**
   * Initializes the cursor with a starting block number.
   */
  async initializeCursor(client: PoolClient, startBlock: bigint): Promise<void> {
    if (startBlock < 0n) {
      throw new Error('Start block must be non-negative.');
    }

    await client.query(
      `
      INSERT INTO ${this._schema}._cursor (
        chain_id,
        fetched_to_block,
        created_at,
        updated_at
      ) VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (chain_id) DO NOTHING
    `,
      [this._chainId, startBlock.toString()],
    );
  }

  /**
   * Advances the fetched_to_block cursor to the specified block number.
   * WARNING: Assumes single fetcher per chain. If multiple fetchers run concurrently,
   * call getCursorForUpdate() first to prevent race conditions.
   */
  async advanceFetchedTo(tx: PoolClient, toBlock: bigint): Promise<void> {
    if (toBlock < 0n) {
      throw new Error('Block number must be non-negative.');
    }

    await tx.query(
      `
      UPDATE ${this._schema}._cursor
      SET fetched_to_block = $2, updated_at = NOW()
      WHERE chain_id = $1
    `,
      [this._chainId, toBlock.toString()],
    );
  }

  /**
   * Resets the cursor to a specific block, clearing all processing state.
   */
  async resetCursor(tx: PoolClient, toBlock: bigint): Promise<void> {
    if (toBlock < 0n) {
      throw new Error('Block number must be non-negative.');
    }

    await tx.query(
      `
      UPDATE ${this._schema}._cursor
      SET
        fetched_to_block = $2,
        updated_at = NOW()
      WHERE chain_id = $1
    `,
      [this._chainId, toBlock.toString()],
    );
  }

  /**
   * Converts a database row to a Cursor object.
   */
  private _rowToCursor(row: CursorRow): Cursor {
    return {
      chainId: row.chain_id,
      fetchedToBlock: BigInt(row.fetched_to_block),
      updatedAt: row.updated_at,
    };
  }
}
