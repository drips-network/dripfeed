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
 * Ensures that a project exists in the database for each receiver.
 * Creates unclaimed project entries for any receivers that don't have a corresponding project.
 */
export async function ensureProjectReceivers(
  receivers: ReceiverWithSource[],
  projectsRepo: ProjectsRepository,
  eventPointer: EventPointer,
): Promise<void> {
  await Promise.all(
    receivers.map((receiver) => {
      const { forge, ownerName, repoName } = receiver.source;
      const name = `${ownerName}/${repoName}`;

      return projectsRepo.ensureUnclaimedProject(
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
