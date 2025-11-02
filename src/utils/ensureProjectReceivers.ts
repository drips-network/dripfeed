import type z from 'zod';

import type { sourceSchema } from '../metadata/schemas/common/sources.js';
import type { ProjectsRepository } from '../repositories/ProjectsRepository.js';
import type { EventPointer } from '../repositories/types.js';

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
  projectsRepo: ProjectsRepository,
  eventPointer: EventPointer,
): Promise<void> {
  await Promise.all(
    receivers.map(async (receiver) => {
      const { forge, ownerName, repoName } = receiver.source;
      const name = `${ownerName}/${repoName}`;

      await projectsRepo.ensureUnclaimedProject(
        {
          account_id: receiver.accountId,
          forge,
          name,
          url: forgeToUrl(forge, name),
        },
        eventPointer,
      );
    }),
  );
}
