import type { PoolClient } from 'pg';
import { createSelectSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { linkedIdentities } from '../db/schema.js';
import { upsertPartial, update } from '../db/replayableOps.js';
import { validateSchemaName } from '../utils/sqlValidation.js';
import { logger } from '../logger.js';

import type { UpdateResult, EventPointer } from './types.js';

const linkedIdentitySchema = createSelectSchema(linkedIdentities);
export type LinkedIdentity = z.infer<typeof linkedIdentitySchema>;
export type LinkedIdentityType = z.infer<typeof linkedIdentitySchema.shape.identity_type>;

const ensureUnclaimedLinkedIdentityInputSchema = linkedIdentitySchema.pick({
  account_id: true,
  identity_type: true,
});
type EnsureUnclaimedLinkedIdentity = z.infer<typeof ensureUnclaimedLinkedIdentityInputSchema>;

const updateLinkedIdentityDataInputSchema = linkedIdentitySchema
  .omit({
    identity_type: true,
    created_at: true,
    updated_at: true,
  })
  .partial()
  .required({ account_id: true });

export type UpdateLinkedIdentityData = z.infer<typeof updateLinkedIdentityDataInputSchema>;

const IMMUTABLE_FIELDS: Set<keyof LinkedIdentity> = new Set([
  'account_id',
  'created_at',
  'updated_at',
] as const satisfies ReadonlyArray<keyof LinkedIdentity>);
const ALLOWED_UPDATE_FIELDS = new Set(
  Object.keys(linkedIdentitySchema.shape).filter(
    (key) => !IMMUTABLE_FIELDS.has(key as keyof LinkedIdentity),
  ),
);

export class LinkedIdentitiesRepository {
  constructor(
    private readonly client: PoolClient,
    private readonly schema: string,
  ) {
    validateSchemaName(schema);
  }

  async getLinkedIdentity(accountId: string): Promise<LinkedIdentity | null> {
    const result = await this.client.query<LinkedIdentity>(
      `SELECT * FROM ${this.schema}.linked_identities WHERE account_id = $1`,
      [accountId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return linkedIdentitySchema.parse(result.rows[0]);
  }

  /**
   * Ensures a linked identity exists in an **unclaimed baseline state**.
   *
   * If no linked identity exists for the given account ID, one is created.
   * If a linked identity already exists, it is reset to the unclaimed baseline.
   *
   * @param data - Linked identity data.
   * @param eventPointer - Blockchain event that triggered this operation.
   * @returns The persisted linked identity row.
   */
  async ensureUnclaimedLinkedIdentity(
    data: EnsureUnclaimedLinkedIdentity,
    eventPointer: EventPointer,
  ): Promise<LinkedIdentity> {
    ensureUnclaimedLinkedIdentityInputSchema.parse(data);

    const existing = await this.getLinkedIdentity(data.account_id);

    // Security check: prevent resetting claimed linked identities with new events.
    // Only allow reset if this is a replay event (older than existing state).
    if (existing && existing.owner_address !== null) {
      // If existing event pointer fields are null, we cannot determine replay status.
      // Proceed with reset (defensive: assume valid).
      if (
        existing.last_event_block === null ||
        existing.last_event_tx_index === null ||
        existing.last_event_log_index === null
      ) {
        logger.warn('owner_update_requested_claimed_linked_identity_missing_event_pointer', {
          account_id: data.account_id,
          existing_owner: existing.owner_address,
        });
      } else {
        const isReplay =
          eventPointer.last_event_block < existing.last_event_block ||
          (eventPointer.last_event_block === existing.last_event_block &&
            eventPointer.last_event_tx_index < existing.last_event_tx_index) ||
          (eventPointer.last_event_block === existing.last_event_block &&
            eventPointer.last_event_tx_index === existing.last_event_tx_index &&
            eventPointer.last_event_log_index <= existing.last_event_log_index);

        if (!isReplay) {
          // This is a new event attempting to reset a claimed linked identity (potential attack).
          // Skip reset and return existing linked identity unchanged.
          logger.warn('owner_update_requested_ignored_claimed_linked_identity', {
            account_id: data.account_id,
            existing_owner: existing.owner_address,
            existing_event_block: existing.last_event_block.toString(),
            request_event_block: eventPointer.last_event_block.toString(),
          });
          return existing;
        }

        // This is a replay event (reorg recovery). Proceed with reset.
      }
    }

    const upsertData = {
      account_id: data.account_id,
      identity_type: data.identity_type,
      owner_address: null,
      owner_account_id: null,
      are_splits_valid: false, // Until it splits 100% to owner.
      is_visible: true,
      last_event_block: eventPointer.last_event_block,
      last_event_tx_index: eventPointer.last_event_tx_index,
      last_event_log_index: eventPointer.last_event_log_index,
    };

    const result = await upsertPartial<
      LinkedIdentity,
      typeof upsertData,
      'account_id',
      | 'identity_type'
      | 'owner_address'
      | 'owner_account_id'
      | 'are_splits_valid'
      | 'last_event_block'
      | 'last_event_tx_index'
      | 'last_event_log_index',
      LinkedIdentity
    >({
      client: this.client,
      table: `${this.schema}.linked_identities`,
      data: upsertData,
      conflictColumns: ['account_id'],
      updateColumns: [
        'identity_type',
        'owner_address',
        'owner_account_id',
        'are_splits_valid',
        'last_event_block',
        'last_event_tx_index',
        'last_event_log_index',
      ],
    });

    const linkedIdentity = linkedIdentitySchema.parse(result.rows[0]);
    return linkedIdentity;
  }

  async updateLinkedIdentity(
    data: UpdateLinkedIdentityData,
    eventPointer: EventPointer,
  ): Promise<UpdateResult<LinkedIdentity>> {
    updateLinkedIdentityDataInputSchema.parse(data);

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
      LinkedIdentity,
      typeof updateData,
      'account_id',
      keyof typeof updateData,
      LinkedIdentity
    >({
      client: this.client,
      table: `${this.schema}.linked_identities`,
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

    const linkedIdentity = linkedIdentitySchema.parse(result.rows[0]);
    return { success: true, data: linkedIdentity };
  }
}
