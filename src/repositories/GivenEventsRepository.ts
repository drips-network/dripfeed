import type { PoolClient } from 'pg';
import { createInsertSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { givenEvents } from '../db/schema.js';
import { upsert } from '../db/replayableOps.js';
import { validateSchemaName } from '../utils/sqlValidation.js';

const givenEventInsertSchema = createInsertSchema(givenEvents).omit({
  created_at: true,
  updated_at: true,
});

export type GivenEventInput = z.infer<typeof givenEventInsertSchema>;

export class GivenEventsRepository {
  constructor(
    private readonly client: PoolClient,
    private readonly schema: string,
  ) {
    validateSchemaName(schema);
  }

  async upsert(input: GivenEventInput): Promise<void> {
    const validated = givenEventInsertSchema.parse(input);

    await upsert({
      client: this.client,
      table: `${this.schema}.given_events`,
      data: validated,
      conflictColumns: ['transaction_hash', 'log_index'],
    });
  }
}
