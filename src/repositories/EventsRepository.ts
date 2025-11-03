import type { Pool, PoolClient } from 'pg';

import { validateSchemaName } from '../utils/sqlValidation.js';

export type Event = {
  id: number;
  chainId: string;
  blockNumber: bigint;
  blockTimestamp: Date;
  txIndex: number;
  logIndex: number;
  transactionHash: string;
  blockHash: string;
  contractAddress: string;
  eventName: string;
  eventSig: string;
  args: Record<string, unknown>;
  status: 'pending' | 'processed' | 'failed';
  errorMessage: string | null;
  createdAt: Date;
};

export type InsertEventParams = {
  chainId: string;
  blockNumber: bigint;
  blockTimestamp: Date;
  txIndex: number;
  logIndex: number;
  transactionHash: string;
  blockHash: string;
  contractAddress: string;
  eventName: string;
  eventSig: string;
  args: Record<string, unknown>;
};

type EventRow = {
  id: number;
  chain_id: string;
  block_number: string | number | bigint;
  block_timestamp: Date;
  tx_index: number;
  log_index: number;
  transaction_hash: string;
  block_hash: string;
  contract_address: string;
  event_name: string;
  event_sig: string;
  args: Record<string, unknown>;
  status: 'pending' | 'processed' | 'failed';
  error_message: string | null;
  created_at: Date;
};

export class EventRepository {
  private readonly _schema: string;

  private readonly _chainId: string;

  private static readonly _MAX_POSTGRES_PARAMS = 65535;

  constructor(schema: string, chainId: string) {
    this._schema = validateSchemaName(schema);

    if (!chainId || typeof chainId !== 'string' || chainId.trim() === '') {
      throw new Error('Chain ID must be a non-empty string.');
    }
    this._chainId = chainId.trim();
  }

  /**
   * Converts a database row to an Event object.
   */
  private _rowToEvent(row: EventRow): Event {
    return {
      id: row.id,
      chainId: row.chain_id,
      blockNumber: BigInt(row.block_number),
      blockTimestamp: row.block_timestamp,
      txIndex: row.tx_index,
      logIndex: row.log_index,
      transactionHash: row.transaction_hash,
      blockHash: row.block_hash,
      contractAddress: row.contract_address,
      eventName: row.event_name,
      eventSig: row.event_sig,
      args: row.args,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    };
  }

  /**
   * Inserts multiple events into the database.
   */
  async insertEvents(tx: PoolClient, events: InsertEventParams[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const columns: string[] = [
      'chain_id',
      'block_number',
      'block_timestamp',
      'tx_index',
      'log_index',
      'transaction_hash',
      'block_hash',
      'contract_address',
      'event_name',
      'event_sig',
      'args',
      'status',
      'created_at',
      'updated_at',
    ];

    const totalParams: number = events.length * columns.length;

    if (totalParams > EventRepository._MAX_POSTGRES_PARAMS) {
      throw new Error(
        `Batch size exceeds PostgreSQL parameter limit: ${totalParams} > ${EventRepository._MAX_POSTGRES_PARAMS}`,
      );
    }

    const values: unknown[] = [];
    const rows: string[] = events.map((event, eventIndex) => {
      const parameterOffset: number = eventIndex * columns.length;
      values.push(
        event.chainId,
        event.blockNumber.toString(),
        event.blockTimestamp,
        event.txIndex,
        event.logIndex,
        event.transactionHash,
        event.blockHash,
        event.contractAddress,
        event.eventName,
        event.eventSig,
        JSON.stringify(event.args, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value,
        ),
        'pending',
        new Date(),
        new Date(),
      );
      const placeholders: string = columns
        .map((_, columnIndex) => `$${parameterOffset + columnIndex + 1}`)
        .join(', ');
      return `(${placeholders})`;
    });

    const sql: string = `
    INSERT INTO ${this._schema}._events (${columns.join(', ')})
    VALUES ${rows.join(', ')}
    ON CONFLICT (chain_id, block_number, tx_index, log_index) DO NOTHING
  `;

    await tx.query(sql, values);
  }

  /**
   * Retrieves the next pending event for processing with a lock.
   */
  async getNextPendingEvent(db: Pool | PoolClient): Promise<Event | null> {
    const result = await db.query(
      `
    SELECT *
    FROM ${this._schema}._events
    WHERE chain_id = $1 AND status = 'pending'
    ORDER BY block_number, tx_index, log_index
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `,
      [this._chainId],
    );
    return result.rows[0] ? this._rowToEvent(result.rows[0]) : null;
  }

  /**
   * Retrieves a batch of pending events for processing with locks.
   */
  async getNextPendingEventBatch(db: Pool | PoolClient, batchSize: number): Promise<Event[]> {
    const result = await db.query(
      `
    SELECT *
    FROM ${this._schema}._events
    WHERE chain_id = $1 AND status = 'pending'
    ORDER BY block_number, tx_index, log_index
    LIMIT $2
    FOR UPDATE SKIP LOCKED
  `,
      [this._chainId, batchSize],
    );
    return result.rows.map((row) => this._rowToEvent(row));
  }

  /**
   * Marks an event as successfully processed.
   */
  async markEventProcessed(
    tx: PoolClient,
    blockNumber: bigint,
    txIndex: number,
    logIndex: number,
  ): Promise<void> {
    const result = await tx.query(
      `
    UPDATE ${this._schema}._events
    SET status = 'processed', processed_at = NOW(), updated_at = NOW()
    WHERE chain_id = $1
      AND block_number = $2
      AND tx_index = $3
      AND log_index = $4
  `,
      [this._chainId, blockNumber.toString(), txIndex, logIndex],
    );
    // Fail fast if another worker already moved the event.
    if (result.rowCount !== 1) {
      throw new Error(
        `Failed to mark event processed: ${this._chainId}:${blockNumber}:${txIndex}:${logIndex}`,
      );
    }
  }

  /**
   * Marks an event as permanently failed.
   *
   * Processing failures indicate bugs or unrecoverable errors that require investigation.
   * No retry logic exists at the handler level - failures are immediate and final.
   */
  async markEventFailed(
    tx: PoolClient,
    blockNumber: bigint,
    txIndex: number,
    logIndex: number,
    errorMessage: string,
  ): Promise<void> {
    const result = await tx.query(
      `
    UPDATE ${this._schema}._events
    SET
      status = 'failed',
      error_message = $5,
      updated_at = NOW()
    WHERE chain_id = $1
      AND block_number = $2
      AND tx_index = $3
      AND log_index = $4
      AND status = 'pending'
  `,
      [this._chainId, blockNumber.toString(), txIndex, logIndex, errorMessage],
    );
    if (result.rowCount !== 1) {
      return;
    }
  }

  /**
   * Checks if any events exist from a specific block onwards.
   */
  async hasEventsFromBlock(tx: PoolClient, fromBlock: bigint): Promise<boolean> {
    const result = await tx.query(
      `
    SELECT EXISTS(
      SELECT 1 FROM ${this._schema}._events
      WHERE chain_id = $1
        AND block_number >= $2
    ) AS has_events
  `,
      [this._chainId, fromBlock.toString()],
    );
    return result.rows[0].has_events;
  }

  /**
   * Deletes all events from a specific block onwards.
   */
  async deleteEventsFromBlock(tx: PoolClient, fromBlock: bigint): Promise<void> {
    await tx.query(
      `
    DELETE FROM ${this._schema}._events
    WHERE chain_id = $1 AND block_number >= $2
  `,
      [this._chainId, fromBlock.toString()],
    );
  }
}
