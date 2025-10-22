import type { PoolClient } from 'pg';
import { createInsertSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { streamsSetEvents } from '../db/schema.js';
import { upsert } from '../db/replayableOps.js';
import { validateSchemaName } from '../utils/sqlValidation.js';

const streamsSetEventInsertSchema = createInsertSchema(streamsSetEvents).omit({
  created_at: true,
  updated_at: true,
});

export type StreamsSetEventInput = z.infer<typeof streamsSetEventInsertSchema>;

export class StreamsSetEventsRepository {
  constructor(
    private readonly client: PoolClient,
    private readonly schema: string,
  ) {
    validateSchemaName(schema);
  }

  async upsert(input: StreamsSetEventInput): Promise<void> {
    const validated = streamsSetEventInsertSchema.parse(input);

    await upsert({
      client: this.client,
      table: `${this.schema}.streams_set_events`,
      data: validated,
      conflictColumns: ['transaction_hash', 'log_index'],
    });
  }
}
