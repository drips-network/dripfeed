import { getContractNameFromAccountId } from './getContractNameFromAccountId.js';

export function isImmutableSplitsDriverId(id: string): boolean {
  const isNaN = Number.isNaN(Number(id));
  const immutableSplitsDriverId = getContractNameFromAccountId(id) === 'immutableSplitsDriver';

  if (isNaN || !immutableSplitsDriverId) {
    return false;
  }

  return true;
}
