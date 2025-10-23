import type { PoolClient } from 'pg';
import { createSelectSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { splitsReceivers } from '../db/schema.js';
import { validateSchemaName } from '../utils/sqlValidation.js';
import type { ValidSplitCombination } from '../utils/splitRules.js';

import type { EventPointer } from './types.js';

const splitReceiverSchema = createSelectSchema(splitsReceivers);
export type SplitReceiver = z.infer<typeof splitReceiverSchema>;

const splitReceiverInputSchema = splitReceiverSchema
  .omit({
    id: true,
    created_at: true,
    updated_at: true,
    last_event_block: true,
    last_event_tx_index: true,
    last_event_log_index: true,
  })
  .partial({ splits_to_repo_driver_sub_account: true });

type BaseSplitReceiverInput = z.infer<typeof splitReceiverInputSchema>;

export type SplitReceiverInput = Omit<
  BaseSplitReceiverInput,
  'sender_account_type' | 'receiver_account_type' | 'relationship_type'
> &
  ValidSplitCombination;

export class SplitsRepository {
  constructor(
    private readonly client: PoolClient,
    private readonly schema: string,
  ) {
    validateSchemaName(schema);
  }

  async getCurrentSplitReceiversByReceiversHash(receiversHash: string): Promise<SplitReceiver[]> {
    const result = await this.client.query<SplitReceiver>(
      `SELECT sr.* FROM ${this.schema}.splits_receivers sr
         WHERE sr.sender_account_id IN (
           SELECT DISTINCT (args->>'accountId')::text
           FROM ${this.schema}._events
           WHERE event_name = 'StreamReceiverSeen'
             AND args->>'receiversHash' = $1
         )`,
      [receiversHash],
    );

    return result.rows.map((row) => splitReceiverSchema.parse(row));
  }

  /**
   * Retrieves current split receivers for a sender account.
   *
   * @param senderAccountId - The account sending splits.
   * @returns Array of split receivers for the sender account, or empty array if none found.
   */
  async getCurrentSplitReceiversBySender(senderAccountId: string): Promise<SplitReceiver[]> {
    const result = await this.client.query<SplitReceiver>(
      `SELECT * FROM ${this.schema}.splits_receivers WHERE sender_account_id = $1`,
      [senderAccountId],
    );

    return result.rows.map((row) => splitReceiverSchema.parse(row));
  }

  /**
   * Atomically replaces all splits for a sender account.
   *
   * Deletes existing splits from `splits_receivers`, then creates new ones.
   *
   * NOT replayable: the DELETE operation is destructive. However, this method
   * is executed within a transaction (see event processor), so all
   * operations either succeed together or rollback together. No partial state
   * persists on failure.
   *
   * @param senderAccountId - The account sending splits.
   * @param splits - Array of new split receivers to create.
   * @param eventPointer - Blockchain event that triggered this operation.
   * @returns Object containing newly created split receivers.
   */
  async replaceSplitsForSender(
    senderAccountId: string,
    splits: ReadonlyArray<SplitReceiverInput>,
    eventPointer: EventPointer,
  ): Promise<{ newSplits: SplitReceiver[] }> {
    for (const split of splits) {
      splitReceiverInputSchema.parse(split);

      if (split.sender_account_id !== senderAccountId) {
        throw new Error(
          `Split sender_account_id ${split.sender_account_id} does not match expected ${senderAccountId}`,
        );
      }
    }

    // Delete existing splits (non-replayable operation).
    await this.client.query(
      `DELETE FROM ${this.schema}.splits_receivers
       WHERE sender_account_id = $1`,
      [senderAccountId],
    );

    // Batch insert all new splits in a single query.
    if (splits.length === 0) {
      return { newSplits: [] };
    }

    const columns = [
      'sender_account_id',
      'sender_account_type',
      'receiver_account_id',
      'receiver_account_type',
      'relationship_type',
      'weight',
      'block_timestamp',
      'splits_to_repo_driver_sub_account',
      'last_event_block',
      'last_event_tx_index',
      'last_event_log_index',
    ];

    const values: unknown[] = [];
    const valuePlaceholders: string[] = [];
    let paramIndex = 1;

    for (const split of splits) {
      const rowPlaceholders = [];
      for (const col of columns) {
        if (col === 'splits_to_repo_driver_sub_account') {
          values.push(split[col] ?? null);
        } else if (col === 'last_event_block') {
          values.push(eventPointer.last_event_block);
        } else if (col === 'last_event_tx_index') {
          values.push(eventPointer.last_event_tx_index);
        } else if (col === 'last_event_log_index') {
          values.push(eventPointer.last_event_log_index);
        } else {
          values.push(split[col as keyof SplitReceiverInput]);
        }
        rowPlaceholders.push(`$${paramIndex++}`);
      }
      valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`);
    }

    const result = await this.client.query<SplitReceiver>(
      `INSERT INTO ${this.schema}.splits_receivers (${columns.map((c) => `"${c}"`).join(', ')})
       VALUES ${valuePlaceholders.join(', ')}
       ON CONFLICT (sender_account_id, receiver_account_id, relationship_type)
       DO UPDATE SET
         sender_account_type = EXCLUDED.sender_account_type,
         receiver_account_type = EXCLUDED.receiver_account_type,
         weight = EXCLUDED.weight,
         block_timestamp = EXCLUDED.block_timestamp,
         splits_to_repo_driver_sub_account = EXCLUDED.splits_to_repo_driver_sub_account,
         last_event_block = EXCLUDED.last_event_block,
         last_event_tx_index = EXCLUDED.last_event_tx_index,
         last_event_log_index = EXCLUDED.last_event_log_index,
         updated_at = NOW()
       RETURNING *`,
      values,
    );

    return { newSplits: result.rows.map((row) => splitReceiverSchema.parse(row)) };
  }
}
