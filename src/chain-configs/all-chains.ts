import type { dripsAbi } from './abis/dripsAbi.js';
import type { nftDriverAbi } from './abis/nftDriverAbi.js';
import type { addressDriverAbi } from './abis/addressDriverAbi.js';
import type { repoSubAccountDriverAbi } from './abis/repoSubAccountDriverAbi.js';
import type { repoDeadlineDriverAbi } from './abis/repoDeadlineDriverAbi.js';
import type { repoDriverLegacyAbi } from './abis/repoDriverLegacyAbi.js';
import type { repoDriverAbi } from './abis/repoDriverAbi.js';

export type DripsAbi = typeof dripsAbi;
export type NftDriverAbi = typeof nftDriverAbi;
export type AddressDriverAbi = typeof addressDriverAbi;
export type RepoSubAccountDriverAbi = typeof repoSubAccountDriverAbi;
export type RepoDeadlineDriverAbi = typeof repoDeadlineDriverAbi;

// RepoDriver has two implementations:
//   - Legacy (mainnet only): OwnerUpdateRequested without 'payer' parameter
//   - Current (all other chains): OwnerUpdateRequested with 'payer' parameter
export type RepoDriverAbi = typeof repoDriverLegacyAbi | typeof repoDriverAbi;
