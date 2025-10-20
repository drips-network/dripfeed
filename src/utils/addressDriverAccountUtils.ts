import { getContractNameFromAccountId } from './getContractNameFromAccountId.js';

export function isAddressDriverId(id: string): boolean {
  const isNaN = Number.isNaN(Number(id));
  const isAccountIdOfAddressDriver = getContractNameFromAccountId(id) === 'addressDriver';

  if (isNaN || !isAccountIdOfAddressDriver) {
    return false;
  }

  return true;
}
