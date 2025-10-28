import type { PoolClient } from 'pg';
import { createInsertSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { transferEvents } from '../db/schema.js';
import { upsert } from '../db/replayableOps.js';
import { validateSchemaName } from '../utils/sqlValidation.js';

const transferEventInsertSchema = createInsertSchema(transferEvents).omit({
  created_at: true,
  updated_at: true,
});

export type TransferEventInput = z.infer<typeof transferEventInsertSchema>;

export class TransferEventsRepository {
  constructor(
    private readonly client: PoolClient,
    private readonly schema: string,
  ) {
    validateSchemaName(schema);
  }

  async upsert(input: TransferEventInput): Promise<void> {
    const validated = transferEventInsertSchema.parse(input);

    await upsert({
      client: this.client,
      table: `${this.schema}.transfer_events`,
      data: validated,
      conflictColumns: ['transaction_hash', 'log_index'],
    });
  }
}
