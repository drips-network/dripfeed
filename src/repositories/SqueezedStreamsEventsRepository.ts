import type { PoolClient } from 'pg';
import { createInsertSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { squeezedStreamsEvents } from '../db/schema.js';
import { upsert } from '../db/replayableOps.js';
import { validateSchemaName } from '../utils/sqlValidation.js';

const squeezedStreamsEventInsertSchema = createInsertSchema(squeezedStreamsEvents).omit({
  created_at: true,
  updated_at: true,
});

export type SqueezedStreamsEventInput = z.infer<typeof squeezedStreamsEventInsertSchema>;

export class SqueezedStreamsEventsRepository {
  constructor(
    private readonly client: PoolClient,
    private readonly schema: string,
  ) {
    validateSchemaName(schema);
  }

  async upsert(input: SqueezedStreamsEventInput): Promise<void> {
    const validated = squeezedStreamsEventInsertSchema.parse(input);

    await upsert({
      client: this.client,
      table: `${this.schema}.squeezed_streams_events`,
      data: validated,
      conflictColumns: ['transaction_hash', 'log_index'],
    });
  }
}
