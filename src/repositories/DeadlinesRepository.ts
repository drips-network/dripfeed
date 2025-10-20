import type { PoolClient } from 'pg';
import { createSelectSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { deadlines } from '../db/schema.js';
import { upsertPartial } from '../db/replayableOps.js';
import { validateSchemaName } from '../utils/sqlValidation.js';

import type { EventPointer } from './types.js';

const deadlineSchema = createSelectSchema(deadlines);
export type Deadline = z.infer<typeof deadlineSchema>;

const upsertDeadlineInputSchema = deadlineSchema
  .omit({ created_at: true, updated_at: true })
  .required();

export type UpsertDeadlineData = z.infer<typeof upsertDeadlineInputSchema>;

export class DeadlinesRepository {
  constructor(
    private readonly client: PoolClient,
    private readonly schema: string,
  ) {
    validateSchemaName(schema);
  }

  /**
   * Upserts a deadline.
   *
   * If no deadline exists for the given account ID, one is created.
   * If a deadline already exists, all fields are updated.
   *
   * Replayable: running with the same inputs yields the same persisted
   * state, excluding DB-managed side effects (e.g. timestamps or triggers).
   *
   * @param data - Deadline data.
   * @param eventPointer - Blockchain event that triggered this operation.
   * @returns The persisted deadline row.
   */
  async upsertDeadline(data: UpsertDeadlineData, eventPointer: EventPointer): Promise<Deadline> {
    upsertDeadlineInputSchema.parse(data);

    const upsertData = {
      account_id: data.account_id,
      receiver_account_id: data.receiver_account_id,
      receiver_account_type: data.receiver_account_type,
      claimable_project_id: data.claimable_project_id,
      deadline: data.deadline,
      refund_account_id: data.refund_account_id,
      refund_account_type: data.refund_account_type,
      last_event_block: eventPointer.last_event_block,
      last_event_tx_index: eventPointer.last_event_tx_index,
      last_event_log_index: eventPointer.last_event_log_index,
    };

    const result = await upsertPartial<
      Deadline,
      typeof upsertData,
      'account_id',
      | 'receiver_account_id'
      | 'receiver_account_type'
      | 'claimable_project_id'
      | 'deadline'
      | 'refund_account_id'
      | 'refund_account_type'
      | 'last_event_block'
      | 'last_event_tx_index'
      | 'last_event_log_index',
      Deadline
    >({
      client: this.client,
      table: `${this.schema}.deadlines`,
      data: upsertData,
      conflictColumns: ['account_id'],
      updateColumns: [
        'receiver_account_id',
        'receiver_account_type',
        'claimable_project_id',
        'deadline',
        'refund_account_id',
        'refund_account_type',
        'last_event_block',
        'last_event_tx_index',
        'last_event_log_index',
      ],
    });

    const deadline = deadlineSchema.parse(result.rows[0]);
    return deadline;
  }
}
