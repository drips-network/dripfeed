import type { PoolClient } from 'pg';
import { createInsertSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { streamReceiverSeenEvents } from '../db/schema.js';
import { upsert } from '../db/replayableOps.js';
import { validateSchemaName } from '../utils/sqlValidation.js';

const streamReceiverSeenEventInsertSchema = createInsertSchema(streamReceiverSeenEvents).omit({
  created_at: true,
  updated_at: true,
});

export type StreamReceiverSeenEventInput = z.infer<typeof streamReceiverSeenEventInsertSchema>;

export class StreamReceiverSeenEventsRepository {
  constructor(
    private readonly client: PoolClient,
    private readonly schema: string,
  ) {
    validateSchemaName(schema);
  }

  async upsert(input: StreamReceiverSeenEventInput): Promise<void> {
    const validated = streamReceiverSeenEventInsertSchema.parse(input);

    await upsert({
      client: this.client,
      table: `${this.schema}.stream_receiver_seen_events`,
      data: validated,
      conflictColumns: ['transaction_hash', 'log_index'],
    });
  }
}
