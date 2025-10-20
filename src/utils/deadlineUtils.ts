import { getContractNameFromAccountId } from './getContractNameFromAccountId.js';

export function isDeadlineId(id: string): boolean {
  const isNaN = Number.isNaN(Number(id));

  if (isNaN) {
    return false;
  }

  try {
    const contractName = getContractNameFromAccountId(id);
    return contractName === 'repoDeadlineDriver';
  } catch {
    return false;
  }
}
