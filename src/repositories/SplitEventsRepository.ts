import type { PoolClient } from 'pg';
import { createInsertSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { splitEvents } from '../db/schema.js';
import { upsert } from '../db/replayableOps.js';
import { validateSchemaName } from '../utils/sqlValidation.js';

const splitEventInsertSchema = createInsertSchema(splitEvents).omit({
  created_at: true,
  updated_at: true,
});

export type SplitEventInput = z.infer<typeof splitEventInsertSchema>;

export class SplitEventsRepository {
  constructor(
    private readonly client: PoolClient,
    private readonly schema: string,
  ) {
    validateSchemaName(schema);
  }

  async upsert(input: SplitEventInput): Promise<void> {
    const validated = splitEventInsertSchema.parse(input);

    await upsert({
      client: this.client,
      table: `${this.schema}.split_events`,
      data: validated,
      conflictColumns: ['transaction_hash', 'log_index'],
    });
  }
}
