import type { PoolClient } from 'pg';
import { createSelectSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { projects } from '../db/schema.js';
import { update } from '../db/db.js';
import { validateSchemaName } from '../utils/sqlValidation.js';

import type { UpdateResult, EventPointer } from './types.js';

export const projectSchema = createSelectSchema(projects);
export type Project = z.infer<typeof projectSchema>;
export type Forge = z.infer<typeof projectSchema.shape.forge>;
export type ProjectStatus = z.infer<typeof projectSchema.shape.verification_status>;

const updateProjectDataInputSchema = projectSchema
  .omit({
    name: true,
    forge: true,
    verification_status: true,
    created_at: true,
    updated_at: true,
  })
  .partial()
  .required({ account_id: true });

export type UpdateProjectData = z.infer<typeof updateProjectDataInputSchema>;

const IMMUTABLE_FIELDS: Set<keyof Project> = new Set([
  'account_id',
  'created_at',
  'updated_at',
] as const satisfies ReadonlyArray<keyof Project>);
const ALLOWED_UPDATE_FIELDS = new Set(
  Object.keys(projectSchema.shape).filter((key) => !IMMUTABLE_FIELDS.has(key as keyof Project)),
);

export class ProjectsRepository {
  constructor(
    private readonly client: PoolClient,
    private readonly schema: string,
  ) {
    validateSchemaName(schema);
  }

  /**
   * Applies a set of field updates to an existing project.
   *
   * Only explicitly provided fields are updated; others remain unchanged.
   *
   * The `verification_status` is automatically computed based on the presence
   * of owner and metadata fields. It should not be included in the updates.
   *
   * Replayable: re-running this operation with the same inputs
   * yields the same persisted state, excluding DB-managed side effects
   * (e.g. timestamps or triggers).
   *
   * @param data.account_id - Target project account ID.
   * @param data - Partial field map to update.
   * @param eventPointer - Blockchain event that triggered this operation.
   * @returns UpdateResult containing the persisted project row or not_found reason.
   */
  async updateProject(
    data: UpdateProjectData,
    eventPointer: EventPointer,
  ): Promise<UpdateResult<Project>> {
    updateProjectDataInputSchema.parse(data);

    const { account_id, ...updates } = data;

    if ('verification_status' in data) {
      throw new Error('verification_status is computed and cannot be set directly');
    }

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

    const isUpdatingOwner = 'owner_address' in updates;
    const isUpdatingHash = 'last_processed_ipfs_hash' in updates;
    const newOwnerValue = updates.owner_address;
    const newHashValue = updates.last_processed_ipfs_hash;

    const ownerCheck = isUpdatingOwner
      ? newOwnerValue !== null
        ? 'TRUE'
        : 'FALSE'
      : 'owner_address IS NOT NULL';

    const hashCheck = isUpdatingHash
      ? newHashValue !== null
        ? 'TRUE'
        : 'FALSE'
      : 'last_processed_ipfs_hash IS NOT NULL';

    const ownerNullCheck = isUpdatingOwner
      ? newOwnerValue === null
        ? 'TRUE'
        : 'FALSE'
      : 'owner_address IS NULL';

    const hashNullCheck = isUpdatingHash
      ? newHashValue === null
        ? 'TRUE'
        : 'FALSE'
      : 'last_processed_ipfs_hash IS NULL';

    const result = await update<
      Project,
      typeof updateData,
      'account_id',
      keyof typeof updateData,
      Project
    >({
      client: this.client,
      table: `${this.schema}.projects`,
      data: updateData,
      whereColumns: ['account_id'],
      updateColumns: [
        ...Object.keys(updates),
        'last_event_block',
        'last_event_tx_index',
        'last_event_log_index',
      ] as Array<keyof typeof updateData>,
      computedColumns: {
        verification_status: `
          (CASE
            WHEN ${ownerCheck} AND ${hashCheck} THEN 'claimed'
            WHEN ${ownerNullCheck} AND ${hashNullCheck} THEN 'unclaimed'
            WHEN ${ownerCheck} AND ${hashNullCheck} THEN 'pending_metadata'
            ELSE 'unclaimed'
          END)::"${this.schema}".verification_status
        `.trim(),
      },
    });

    if (result.rows.length === 0) {
      return { success: false, reason: 'not_found' };
    }

    const project = projectSchema.parse(result.rows[0]);
    return { success: true, data: project };
  }
}
