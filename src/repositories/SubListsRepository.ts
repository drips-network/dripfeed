import type { PoolClient } from 'pg';
import { createSelectSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { subLists } from '../db/schema.js';
import { upsertPartial, update } from '../db/db.js';
import { validateSchemaName } from '../utils/sqlValidation.js';

import type { UpdateResult, EventPointer } from './types.js';

const subListSchema = createSelectSchema(subLists);
export type SubList = z.infer<typeof subListSchema>;

const upsertSubListInputSchema = subListSchema.pick({
  account_id: true,
  is_valid: true,
  parent_account_id: true,
  parent_account_type: true,
  root_account_id: true,
  root_account_type: true,
  last_processed_ipfs_hash: true,
});

export type UpsertSubListData = z.infer<typeof upsertSubListInputSchema>;

const updateSubListInputSchema = subListSchema
  .omit({
    created_at: true,
    updated_at: true,
  })
  .partial()
  .required({ account_id: true });

export type UpdateSubListData = z.infer<typeof updateSubListInputSchema>;

const IMMUTABLE_FIELDS: Set<keyof SubList> = new Set([
  'account_id',
  'created_at',
  'updated_at',
] as const satisfies ReadonlyArray<keyof SubList>);

const ALLOWED_UPDATE_FIELDS = new Set(
  Object.keys(subListSchema.shape).filter((key) => !IMMUTABLE_FIELDS.has(key as keyof SubList)),
);

export class SubListsRepository {
  constructor(
    private readonly client: PoolClient,
    private readonly schema: string,
  ) {
    validateSchemaName(schema);
  }

  /**
   * Finds a sub-list by account ID.
   *
   * @param accountId - The sub-list account ID.
   * @returns The sub-list if found, null otherwise.
   */
  async findById(accountId: string): Promise<SubList | null> {
    const result = await this.client.query<SubList>(
      `SELECT * FROM ${this.schema}.sub_lists WHERE account_id = $1`,
      [accountId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return subListSchema.parse(result.rows[0]);
  }

  /**
   * Ensures a sub-list exists, creating it if necessary or updating if it exists.
   *
   * Replayable: running with the same inputs yields the same persisted state.
   *
   * @param data - Sub-list data with required baseline fields.
   * @param eventPointer - Blockchain event that triggered this operation.
   * @returns The persisted sub-list row.
   */
  async upsertSubList(data: UpsertSubListData, eventPointer: EventPointer): Promise<SubList> {
    upsertSubListInputSchema.parse(data);

    const upsertData = {
      account_id: data.account_id,
      is_valid: data.is_valid,
      parent_account_id: data.parent_account_id,
      parent_account_type: data.parent_account_type,
      root_account_id: data.root_account_id,
      root_account_type: data.root_account_type,
      last_processed_ipfs_hash: data.last_processed_ipfs_hash,
      last_event_block: eventPointer.last_event_block,
      last_event_tx_index: eventPointer.last_event_tx_index,
      last_event_log_index: eventPointer.last_event_log_index,
    };

    const result = await upsertPartial<
      SubList,
      typeof upsertData,
      'account_id',
      | 'is_valid'
      | 'parent_account_id'
      | 'parent_account_type'
      | 'root_account_id'
      | 'root_account_type'
      | 'last_processed_ipfs_hash'
      | 'last_event_block'
      | 'last_event_tx_index'
      | 'last_event_log_index',
      SubList
    >({
      client: this.client,
      table: `${this.schema}.sub_lists`,
      data: upsertData,
      conflictColumns: ['account_id'],
      updateColumns: [
        'is_valid',
        'parent_account_id',
        'parent_account_type',
        'root_account_id',
        'root_account_type',
        'last_processed_ipfs_hash',
        'last_event_block',
        'last_event_tx_index',
        'last_event_log_index',
      ],
    });

    const subList = subListSchema.parse(result.rows[0]);
    return subList;
  }

  /**
   * Applies a set of field updates to an existing sub-list.
   *
   * Only explicitly provided fields are updated; others remain unchanged.
   *
   * Replayable: re-running this operation with the same inputs
   * yields the same persisted state, excluding DB-managed side effects.
   *
   * @param data.account_id - Target sub-list ID.
   * @param data - Partial field map to update.
   * @param eventPointer - Blockchain event that triggered this operation.
   * @returns UpdateResult with the persisted sub-list row or not_found.
   */
  async updateSubList(
    data: UpdateSubListData,
    eventPointer: EventPointer,
  ): Promise<UpdateResult<SubList>> {
    updateSubListInputSchema.parse(data);

    const { account_id, ...updates } = data;

    for (const key of Object.keys(updates)) {
      if (!ALLOWED_UPDATE_FIELDS.has(key)) {
        throw new Error(`Invalid update field: ${key}`);
      }
    }

    const updateData = {
      account_id,
      ...updates,
      last_event_block: eventPointer.last_event_block,
      last_event_tx_index: eventPointer.last_event_tx_index,
      last_event_log_index: eventPointer.last_event_log_index,
    };

    const result = await update<
      SubList,
      typeof updateData,
      'account_id',
      keyof typeof updateData,
      SubList
    >({
      client: this.client,
      table: `${this.schema}.sub_lists`,
      data: updateData,
      whereColumns: ['account_id'],
      updateColumns: [
        ...Object.keys(updates),
        'last_event_block',
        'last_event_tx_index',
        'last_event_log_index',
      ] as Array<keyof typeof updateData>,
    });

    if (result.rows.length === 0) {
      return { success: false, reason: 'not_found' };
    }

    const subList = subListSchema.parse(result.rows[0]);
    return { success: true, data: subList };
  }
}
