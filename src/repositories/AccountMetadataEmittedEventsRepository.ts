import type { PoolClient } from 'pg';
import { createInsertSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { accountMetadataEmittedEvents } from '../db/schema.js';
import { upsert } from '../db/replayableOps.js';
import { validateSchemaName } from '../utils/sqlValidation.js';

const accountMetadataEmittedEventInsertSchema = createInsertSchema(
  accountMetadataEmittedEvents,
).omit({
  created_at: true,
  updated_at: true,
});

export type AccountMetadataEmittedEventInput = z.infer<
  typeof accountMetadataEmittedEventInsertSchema
>;

export class AccountMetadataEmittedEventsRepository {
  constructor(
    private readonly client: PoolClient,
    private readonly schema: string,
  ) {
    validateSchemaName(schema);
  }

  async upsert(input: AccountMetadataEmittedEventInput): Promise<void> {
    const validated = accountMetadataEmittedEventInsertSchema.parse(input);

    await upsert({
      client: this.client,
      table: `${this.schema}.account_metadata_emitted_events`,
      data: validated,
      conflictColumns: ['transaction_hash', 'log_index'],
    });
  }
}
