import { getContractNameFromAccountId } from './getContractNameFromAccountId.js';

export function isNftDriverId(id: string): boolean {
  const isNaN = Number.isNaN(Number(id));
  const isAccountIdOfNftDriver = getContractNameFromAccountId(id) === 'nftDriver';

  if (isNaN || !isAccountIdOfNftDriver) {
    return false;
  }

  return true;
}
