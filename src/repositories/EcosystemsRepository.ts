import type { PoolClient } from 'pg';
import { createSelectSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { ecosystemMainAccounts } from '../db/schema.js';
import { update } from '../db/db.js';
import { validateSchemaName } from '../utils/sqlValidation.js';

import type { UpdateResult, EventPointer } from './types.js';

export const ecosystemMainAccountSchema = createSelectSchema(ecosystemMainAccounts);
export type EcosystemMainAccount = z.infer<typeof ecosystemMainAccountSchema>;

export const upsertEcosystemMainAccountInputSchema = ecosystemMainAccountSchema.pick({
  account_id: true,
  owner_address: true,
  owner_account_id: true,
  is_valid: true,
  is_visible: true,
  last_processed_ipfs_hash: true,
  avatar: true,
  color: true,
});

export type UpsertEcosystemMainAccountData = z.infer<typeof upsertEcosystemMainAccountInputSchema>;

const updateEcosystemMainAccountInputSchema = ecosystemMainAccountSchema
  .omit({
    created_at: true,
    updated_at: true,
  })
  .partial()
  .required({ account_id: true });

export type UpdateEcosystemMainAccountData = z.infer<typeof updateEcosystemMainAccountInputSchema>;

const IMMUTABLE_FIELDS: Set<keyof EcosystemMainAccount> = new Set([
  'account_id',
  'created_at',
  'updated_at',
] as const satisfies ReadonlyArray<keyof EcosystemMainAccount>);

const ALLOWED_UPDATE_FIELDS = new Set(
  Object.keys(ecosystemMainAccountSchema.shape).filter(
    (key) => !IMMUTABLE_FIELDS.has(key as keyof EcosystemMainAccount),
  ),
);

export class EcosystemsRepository {
  constructor(
    private readonly client: PoolClient,
    private readonly schema: string,
  ) {
    validateSchemaName(schema);
  }

  /**
   * Applies a set of field updates to an existing ecosystem main account.
   *
   * Only explicitly provided fields are updated; others remain unchanged.
   *
   * Replayable: re-running this operation with the same inputs
   * yields the same persisted state, excluding DB-managed side effects.
   *
   * @param data.account_id - Target ecosystem main account ID.
   * @param data - Partial field map to update.
   * @param eventPointer - Blockchain event that triggered this operation.
   * @returns UpdateResult with the persisted ecosystem main account row or not_found.
   */
  async updateEcosystemMainAccount(
    data: UpdateEcosystemMainAccountData,
    eventPointer: EventPointer,
  ): Promise<UpdateResult<EcosystemMainAccount>> {
    updateEcosystemMainAccountInputSchema.parse(data);

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
      EcosystemMainAccount,
      typeof updateData,
      'account_id',
      keyof typeof updateData,
      EcosystemMainAccount
    >({
      client: this.client,
      table: `${this.schema}.ecosystem_main_accounts`,
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

    const ecosystem = ecosystemMainAccountSchema.parse(result.rows[0]);
    return { success: true, data: ecosystem };
  }
}
