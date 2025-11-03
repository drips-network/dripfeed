import type { Pool, PoolClient } from 'pg';

import { validateSchemaName } from '../utils/sqlValidation.js';

interface IBlockHash {
  chainId: string;
  blockNumber: bigint;
  blockHash: string;
}

export class BlockHashesRepository {
  private readonly _db: Pool;

  private readonly _schema: string;

  private static readonly _MAX_POSTGRES_PARAMS = 65535;

  constructor(db: Pool, schema: string) {
    this._db = db;
    // Schema name is validated to prevent SQL injection in dynamic queries.
    this._schema = validateSchemaName(schema);
  }

  /**
   * Inserts or refreshes block hashes to keep canonical data current.
   */
  async insertBlockHashes(tx: PoolClient, blocks: IBlockHash[]): Promise<void> {
    if (blocks.length === 0) {
      return;
    }

    const columns: string[] = [
      'chain_id',
      'block_number',
      'block_hash',
      'created_at',
      'updated_at',
    ];
    const totalParams: number = blocks.length * columns.length;

    if (totalParams > BlockHashesRepository._MAX_POSTGRES_PARAMS) {
      throw new Error(
        `Batch size exceeds PostgreSQL parameter limit: ${totalParams} > ${BlockHashesRepository._MAX_POSTGRES_PARAMS}`,
      );
    }

    const values: unknown[] = [];
    const rows: string[] = blocks.map((block, blockIndex) => {
      const parameterOffset: number = blockIndex * columns.length;
      values.push(
        block.chainId,
        block.blockNumber.toString(),
        block.blockHash,
        new Date(),
        new Date(),
      );
      const placeholders: string = columns
        .map((_, columnIndex) => `$${parameterOffset + columnIndex + 1}`)
        .join(', ');
      return `(${placeholders})`;
    });

    const sql: string = `
      INSERT INTO ${this._schema}._block_hashes (${columns.join(', ')})
      VALUES ${rows.join(', ')}
      ON CONFLICT (chain_id, block_number) DO UPDATE
        SET
          block_hash = EXCLUDED.block_hash,
          updated_at = EXCLUDED.updated_at
    `;

    await tx.query(sql, values);
  }

  /**
   * Retrieves block hashes for a range of blocks.
   * Returns a Map of block number to block hash.
   */
  async getBlockHashesInRange(
    chainId: string,
    fromBlock: bigint,
    toBlock: bigint,
    tx?: PoolClient,
  ): Promise<Map<bigint, string>> {
    const db = tx ?? this._db;
    const result = await db.query<{ block_number: string; block_hash: string }>(
      `
      SELECT block_number, block_hash
      FROM ${this._schema}._block_hashes
      WHERE chain_id = $1 AND block_number >= $2 AND block_number <= $3
    `,
      [chainId, fromBlock.toString(), toBlock.toString()],
    );

    const map = new Map<bigint, string>();
    for (const row of result.rows) {
      map.set(BigInt(row.block_number), row.block_hash);
    }
    return map;
  }

  /**
   * Deletes all block hashes from a specific block number onwards for a given chain.
   * Used during reorg handling to remove invalidated blocks.
   */
  async deleteBlockHashesFromBlock(
    tx: PoolClient,
    chainId: string,
    fromBlock: bigint,
  ): Promise<number> {
    const result = await tx.query(
      `
      DELETE FROM ${this._schema}._block_hashes
      WHERE chain_id = $1 AND block_number >= $2
    `,
      [chainId, fromBlock.toString()],
    );
    return result.rowCount ?? 0;
  }

  /**
   * Deletes all block hashes before a specific block number for a given chain.
   * Used to prune old hashes that are no longer needed for reorg detection.
   */
  async deleteBlockHashesBefore(
    tx: PoolClient,
    chainId: string,
    beforeBlock: bigint,
  ): Promise<void> {
    await tx.query(
      `
      DELETE FROM ${this._schema}._block_hashes
      WHERE chain_id = $1 AND block_number < $2
    `,
      [chainId, beforeBlock.toString()],
    );
  }

  /**
   * Retrieves which blocks in a range already have hashes stored.
   * Returns a Set of block numbers that exist in the database.
   * Used by BlockFetcher to avoid redundant RPC calls for blocks with existing hashes.
   */
  async getBlockNumbersWithHashes(
    tx: PoolClient,
    chainId: string,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<Set<bigint>> {
    const result = await tx.query<{ block_number: string }>(
      `
      SELECT block_number
      FROM ${this._schema}._block_hashes
      WHERE chain_id = $1 AND block_number BETWEEN $2 AND $3
    `,
      [chainId, fromBlock.toString(), toBlock.toString()],
    );

    const stored = new Set<bigint>();
    for (const row of result.rows) {
      stored.add(BigInt(row.block_number));
    }
    return stored;
  }
}
