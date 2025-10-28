import type { PoolClient } from 'pg';
import { createInsertSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { splitsSetEvents } from '../db/schema.js';
import { upsert } from '../db/replayableOps.js';
import { validateSchemaName } from '../utils/sqlValidation.js';

const splitsSetEventInsertSchema = createInsertSchema(splitsSetEvents).omit({
  created_at: true,
  updated_at: true,
});

export type SplitsSetEventInput = z.infer<typeof splitsSetEventInsertSchema>;

export class SplitsSetEventsRepository {
  constructor(
    private readonly client: PoolClient,
    private readonly schema: string,
  ) {
    validateSchemaName(schema);
  }

  async upsert(input: SplitsSetEventInput): Promise<void> {
    const validated = splitsSetEventInsertSchema.parse(input);

    await upsert({
      client: this.client,
      table: `${this.schema}.splits_set_events`,
      data: validated,
      conflictColumns: ['transaction_hash', 'log_index'],
    });
  }
}
