import type { Pool, PoolClient } from 'pg';

import { validateSchemaName } from '../utils/sqlValidation.js';

interface IBlockHash {
  chainId: string;
  blockNumber: bigint;
  blockHash: string;
}

interface IBlockHashRow {
  block_hash: string;
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
   * Inserts multiple block hashes into the database.
   * Ignores conflicts to ensure replayability.
   */
  async insertBlockHashes(tx: PoolClient, blocks: IBlockHash[]): Promise<void> {
    if (blocks.length === 0) {
      return;
    }

    const columns: string[] = ['chain_id', 'block_number', 'block_hash', 'created_at', 'updated_at'];
    const totalParams: number = blocks.length * columns.length;

    if (totalParams > BlockHashesRepository._MAX_POSTGRES_PARAMS) {
      throw new Error(
        `Batch size exceeds PostgreSQL parameter limit: ${totalParams} > ${BlockHashesRepository._MAX_POSTGRES_PARAMS}`,
      );
    }

    const values: unknown[] = [];
    const rows: string[] = blocks.map((block, blockIndex) => {
      const parameterOffset: number = blockIndex * columns.length;
      values.push(block.chainId, block.blockNumber.toString(), block.blockHash, new Date(), new Date());
      const placeholders: string = columns
        .map((_, columnIndex) => `$${parameterOffset + columnIndex + 1}`)
        .join(', ');
      return `(${placeholders})`;
    });

    const sql: string = `
      INSERT INTO ${this._schema}._block_hashes (${columns.join(', ')})
      VALUES ${rows.join(', ')}
      ON CONFLICT (chain_id, block_number) DO NOTHING
    `;

    await tx.query(sql, values);
  }

  /**
   * Retrieves the block hash for a specific chain and block number.
   * Returns null if the block hash is not found.
   */
  async getBlockHash(
    chainId: string,
    blockNumber: bigint,
    tx?: PoolClient,
  ): Promise<string | null> {
    const db = tx ?? this._db;
    const result = await db.query<IBlockHashRow>(
      `
      SELECT block_hash
      FROM ${this._schema}._block_hashes
      WHERE chain_id = $1 AND block_number = $2
    `,
      [chainId, blockNumber.toString()],
    );
    return result.rows[0]?.block_hash ?? null;
  }

  /**
   * Deletes all block hashes from a specific block number onwards for a given chain.
   * Used during reorg handling to remove invalidated blocks.
   */
  async deleteBlockHashesFromBlock(
    tx: PoolClient,
    chainId: string,
    fromBlock: bigint,
  ): Promise<void> {
    await tx.query(
      `
      DELETE FROM ${this._schema}._block_hashes
      WHERE chain_id = $1 AND block_number >= $2
    `,
      [chainId, fromBlock.toString()],
    );
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
}
