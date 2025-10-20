import type { Contracts } from '../services/Contracts.js';

import { getContractNameFromAccountId } from './getContractNameFromAccountId.js';

export function isRepoSubAccountDriverId(id: string | bigint): boolean {
  const idString = typeof id === 'bigint' ? id.toString() : id;
  const isNaN = Number.isNaN(Number(idString));
  const isAccountIdOfRepoSubAccountDriver =
    getContractNameFromAccountId(idString) === 'repoSubAccountDriver';

  if (isNaN || !isAccountIdOfRepoSubAccountDriver) {
    return false;
  }

  return true;
}

export async function calcParentRepoDriverId(
  subAccountId: string | bigint,
  contracts: Contracts,
): Promise<string> {
  const idString = typeof subAccountId === 'bigint' ? subAccountId.toString() : subAccountId;

  if (!isRepoSubAccountDriverId(idString)) {
    throw new Error(`Invalid sub-account ID: ${idString} is not a RepoSubAccountDriver ID`);
  }

  const parentId = await contracts.repoSubAccountDriver.read.calcAccountId([BigInt(idString)]);
  return parentId.toString();
}
