import type { PoolClient } from 'pg';
import { createSelectSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { projects } from '../db/schema.js';
import { upsertPartial, update } from '../db/replayableOps.js';
import { validateSchemaName } from '../utils/sqlValidation.js';

import type { UpdateResult, EventPointer } from './types.js';

const projectSchema = createSelectSchema(projects);
export type Project = z.infer<typeof projectSchema>;
export type Forge = z.infer<typeof projectSchema.shape.forge>;
export type ProjectStatus = z.infer<typeof projectSchema.shape.verification_status>;

const ensureUnclaimedProjectInputSchema = projectSchema.pick({
  account_id: true,
  forge: true,
  name: true,
  url: true,
});
type EnsureUnclaimedProject = z.infer<typeof ensureUnclaimedProjectInputSchema>;

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
   * Ensures a project exists in an **unclaimed baseline state**.
   *
   * If no project exists for the given account ID, one is created.
   * If a project already exists, it is reset to the unclaimed baseline.
   *
   * Replayable: running with the same inputs yields the same persisted
   * state, excluding DB-managed side effects (e.g. timestamps or triggers).
   * @param data.account_id - Project account ID.
   * @param data.forge - Source forge.
   * @param data.name - Project name (`<owner>/<repo>`).
   * @param eventPointer - Blockchain event that triggered this operation.
   * @returns The persisted project row.
   */
  async ensureUnclaimedProject(
    data: EnsureUnclaimedProject,
    eventPointer: EventPointer,
  ): Promise<Project> {
    ensureUnclaimedProjectInputSchema.parse(data);

    const upsertData = {
      account_id: data.account_id,
      forge: data.forge,
      name: data.name,
      owner_address: null,
      owner_account_id: null,
      url: data.url,
      verification_status: 'unclaimed' as ProjectStatus,
      is_valid: true, // no splits yet, so valid by default
      is_visible: true,
      last_event_block: eventPointer.last_event_block,
      last_event_tx_index: eventPointer.last_event_tx_index,
      last_event_log_index: eventPointer.last_event_log_index,
    };

    const result = await upsertPartial<
      Project,
      typeof upsertData,
      'account_id',
      | 'forge'
      | 'name'
      | 'url'
      | 'owner_address'
      | 'owner_account_id'
      | 'verification_status'
      | 'last_event_block'
      | 'last_event_tx_index'
      | 'last_event_log_index',
      Project
    >({
      client: this.client,
      table: `${this.schema}.projects`,
      data: upsertData,
      conflictColumns: ['account_id'],
      updateColumns: [
        'forge',
        'name',
        'url',
        'owner_address',
        'owner_account_id',
        'verification_status',
        'last_event_block',
        'last_event_tx_index',
        'last_event_log_index',
      ],
    });

    const project = projectSchema.parse(result.rows[0]);
    return project;
  }

  /**
   * Finds a project by its account ID.
   *
   * @param accountId - Project account ID.
   * @returns The project if found, null otherwise.
   */
  async findById(accountId: string): Promise<Project | null> {
    const result = await this.client.query<Project>(
      `SELECT * FROM ${this.schema}.projects WHERE account_id = $1`,
      [accountId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return projectSchema.parse(result.rows[0]);
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
          END)::${this.schema}.verification_status
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
