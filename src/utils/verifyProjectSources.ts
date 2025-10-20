import type z from 'zod';
import { stringToHex } from 'viem';

import type { gitHubSourceSchema } from '../metadata/schemas/common/sources.js';
import type { Contracts } from '../services/Contracts.js';

import { isRepoDriverId } from './repoDriverAccountUtils.js';
import {
  calcParentRepoDriverId,
  isRepoSubAccountDriverId,
} from './repoSubAccountDriverAccountUtils.js';
import { convertForgeToNumber } from './forgeUtils.js';

/**
 * Verifies that project sources match their on-chain account IDs.
 * Prevents metadata from falsely claiming to represent projects.
 */
export async function verifyProjectSources(
  projects: {
    accountId: string;
    source: z.infer<typeof gitHubSourceSchema>;
  }[],
  contracts: Contracts,
): Promise<void> {
  for (const { accountId, source } of projects) {
    const { forge, ownerName, repoName } = source;

    const expectedParentId = (
      await contracts.repoDriver.read.calcAccountId([
        convertForgeToNumber(forge),
        stringToHex(`${ownerName}/${repoName}`),
      ])
    ).toString();

    // Extract parent ID if sub-account, otherwise use as-is.
    const actualParentId = isRepoSubAccountDriverId(accountId)
      ? await calcParentRepoDriverId(accountId, contracts)
      : accountId;

    if (!isRepoDriverId(actualParentId) && !isRepoSubAccountDriverId(accountId)) {
      throw new Error(`${accountId} is not a valid RepoDriver or RepoSubAccount ID`);
    }

    if (expectedParentId !== actualParentId) {
      throw new Error(
        `Account mismatch for ${ownerName}/${repoName} on ${forge}: expected ${expectedParentId}, got ${actualParentId}`,
      );
    }
  }
}
