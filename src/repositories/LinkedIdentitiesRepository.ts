import type { PoolClient } from 'pg';
import { createSelectSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { linkedIdentities } from '../db/schema.js';
import { update } from '../db/db.js';
import { validateSchemaName } from '../utils/sqlValidation.js';

import type { UpdateResult, EventPointer } from './types.js';

export const linkedIdentitySchema = createSelectSchema(linkedIdentities);
export type LinkedIdentity = z.infer<typeof linkedIdentitySchema>;
export type LinkedIdentityType = z.infer<typeof linkedIdentitySchema.shape.identity_type>;

const updateLinkedIdentityDataInputSchema = linkedIdentitySchema
  .omit({
    identity_type: true,
    created_at: true,
    updated_at: true,
  })
  .partial()
  .required({ account_id: true });

export type UpdateLinkedIdentityData = z.infer<typeof updateLinkedIdentityDataInputSchema>;

export type EnsureLinkedIdentityResult = {
  linkedIdentity: LinkedIdentity;
  created: boolean;
};

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
