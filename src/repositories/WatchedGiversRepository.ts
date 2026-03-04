import type { Pool } from 'pg';

import { validateSchemaName } from '../utils/sqlValidation.js';

export type WatchedGiver = {
  id: bigint;
  giverAddress: string;
  tokenAddress: string;
  chainId: string;
  webhookUrl: string;
  metadata: Record<string, unknown> | null;
  lastKnownBalance: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type WatchedGiverRow = {
  id: string | number | bigint;
  giver_address: string;
  token_address: string;
  chain_id: string;
  webhook_url: string;
  metadata: Record<string, unknown> | null;
  last_known_balance: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

export class WatchedGiversRepository {
  private readonly _schema: string;

  constructor(schema: string) {
    this._schema = validateSchemaName(schema);
  }

  async upsert(
    pool: Pool,
    params: {
      giverAddress: string;
      tokenAddress: string;
      chainId: string;
      webhookUrl: string;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<WatchedGiver> {
    const result = await pool.query(
      `
      INSERT INTO ${this._schema}.watched_givers (
        giver_address, token_address, chain_id, webhook_url, metadata,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (giver_address, token_address, chain_id)
      DO UPDATE SET
        webhook_url = EXCLUDED.webhook_url,
        metadata = EXCLUDED.metadata,
        is_active = true,
        updated_at = NOW()
      RETURNING *
      `,
      [
        params.giverAddress,
        params.tokenAddress,
        params.chainId,
        params.webhookUrl,
        params.metadata ? JSON.stringify(params.metadata) : null,
      ],
    );

    return this._rowToWatchedGiver(result.rows[0]);
  }

  async getActiveBatch(pool: Pool, limit: number, offset: number): Promise<WatchedGiver[]> {
    const result = await pool.query(
      `
      SELECT * FROM ${this._schema}.watched_givers
      WHERE is_active = true
      ORDER BY id
      LIMIT $1 OFFSET $2
      `,
      [limit, offset],
    );

    return result.rows.map((row: WatchedGiverRow) => this._rowToWatchedGiver(row));
  }

  async updateBalance(pool: Pool, id: bigint, newBalance: string): Promise<void> {
    await pool.query(
      `
      UPDATE ${this._schema}.watched_givers
      SET last_known_balance = $2, updated_at = NOW()
      WHERE id = $1
      `,
      [id.toString(), newBalance],
    );
  }

  private _rowToWatchedGiver(row: WatchedGiverRow): WatchedGiver {
    return {
      id: BigInt(row.id),
      giverAddress: row.giver_address,
      tokenAddress: row.token_address,
      chainId: row.chain_id,
      webhookUrl: row.webhook_url,
      metadata: row.metadata,
      lastKnownBalance: row.last_known_balance,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
