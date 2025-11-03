import type { PoolClient } from 'pg';
import { createSelectSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { dripLists } from '../db/schema.js';
import { update } from '../db/db.js';
import { validateSchemaName } from '../utils/sqlValidation.js';

import type { UpdateResult, EventPointer } from './types.js';

export const dripListSchema = createSelectSchema(dripLists);
export type DripList = z.infer<typeof dripListSchema>;

export const upsertDripListInputSchema = dripListSchema.pick({
  account_id: true,
  owner_address: true,
  owner_account_id: true,
  is_valid: true,
  is_visible: true,
});

export type UpsertDripListData = z.infer<typeof upsertDripListInputSchema>;

const updateDripListInputSchema = dripListSchema
  .omit({
    created_at: true,
    updated_at: true,
  })
  .partial()
  .required({ account_id: true });

export type UpdateDripListData = z.infer<typeof updateDripListInputSchema>;

const IMMUTABLE_FIELDS: Set<keyof DripList> = new Set([
  'account_id',
  'created_at',
  'updated_at',
] as const satisfies ReadonlyArray<keyof DripList>);

const ALLOWED_UPDATE_FIELDS = new Set(
  Object.keys(dripListSchema.shape).filter((key) => !IMMUTABLE_FIELDS.has(key as keyof DripList)),
);

export class DripListsRepository {
  constructor(
    private readonly client: PoolClient,
    private readonly schema: string,
  ) {
    validateSchemaName(schema);
  }

  /**
   * Applies a set of field updates to an existing drip list.
   *
   * Only explicitly provided fields are updated; others remain unchanged.
   *
   * Replayable: re-running this operation with the same inputs
   * yields the same persisted state, excluding DB-managed side effects.
   *
   * @param data.account_id - Target drip list account ID.
   * @param data - Partial field map to update.
   * @param eventPointer - Blockchain event that triggered this operation.
   * @returns UpdateResult with the persisted drip list row or not_found.
   */
  async updateDripList(
    data: UpdateDripListData,
    eventPointer: EventPointer,
  ): Promise<UpdateResult<DripList>> {
    updateDripListInputSchema.parse(data);

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
      DripList,
      typeof updateData,
      'account_id',
      keyof typeof updateData,
      DripList
    >({
      client: this.client,
      table: `${this.schema}.drip_lists`,
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

    const dripList = dripListSchema.parse(result.rows[0]);
    return { success: true, data: dripList };
  }
}
