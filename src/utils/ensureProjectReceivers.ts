import type { PoolClient } from 'pg';
import type z from 'zod';

import type { sourceSchema } from '../metadata/schemas/common/sources.js';
import { projectSchema, type Project, type ProjectStatus } from '../repositories/ProjectsRepository.js';
import type { EventPointer } from '../repositories/types.js';
import { insertIgnore } from '../db/db.js';

import { forgeToUrl } from './forgeUtils.js';

type ProjectSource = Exclude<z.infer<typeof sourceSchema>, { forge: 'orcid' }>;

type ReceiverWithSource = {
  accountId: string;
  source: ProjectSource;
};

/**
 * Ensures a project exists without modifying it if already present.
 *
 * Event pointer tracking: If the project exists, its event pointer reflects
 * the last event that MODIFIED it, not this reference. This is intentional
 * to distinguish mutations from mere references.
 */
export async function ensureProjectReceivers(
  receivers: ReceiverWithSource[],
  client: PoolClient,
  schema: string,
  eventPointer: EventPointer,
): Promise<void> {
  // Deduplicate by accountId.
  const seen = new Map<string, ReceiverWithSource>();
  for (const receiver of receivers) {
    if (!seen.has(receiver.accountId)) {
      seen.set(receiver.accountId, receiver);
    }
  }
  const uniqueReceivers = Array.from(seen.values());

  await Promise.all(
    uniqueReceivers.map(async (receiver) => {
      const { forge, ownerName, repoName } = receiver.source;
      const name = `${ownerName}/${repoName}`;

      await insertIgnore<Project>({
        client,
        table: `${schema}.projects`,
        data: {
          account_id: receiver.accountId,
          forge,
          name,
          url: forgeToUrl(forge, name),
          owner_address: null,
          owner_account_id: null,
          verification_status: 'unclaimed' as ProjectStatus,
          is_valid: true,
          is_visible: true,
          last_event_block: eventPointer.last_event_block,
          last_event_tx_index: eventPointer.last_event_tx_index,
          last_event_log_index: eventPointer.last_event_log_index,
        },
        conflictColumns: ['account_id'],
        schema: projectSchema,
      });
    }),
  );
}
