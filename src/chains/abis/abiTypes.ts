import type { dripsAbi } from './dripsAbi.js';
import type { nftDriverAbi } from './nftDriverAbi.js';
import type { addressDriverAbi } from './addressDriverAbi.js';
import type { repoSubAccountDriverAbi } from './repoSubAccountDriverAbi.js';
import type { repoDeadlineDriverAbi } from './repoDeadlineDriverAbi.js';
import type { repoDriverLegacyAbi } from './repoDriverLegacyAbi.js';
import type { repoDriverAbi } from './repoDriverAbi.js';

export type DripsAbi = typeof dripsAbi;
export type NftDriverAbi = typeof nftDriverAbi;
export type AddressDriverAbi = typeof addressDriverAbi;
export type RepoSubAccountDriverAbi = typeof repoSubAccountDriverAbi;
export type RepoDeadlineDriverAbi = typeof repoDeadlineDriverAbi;

// RepoDriver has two implementations:
//   - Legacy (mainnet only): OwnerUpdateRequested without 'payer' parameter
//   - Current (all other chains): OwnerUpdateRequested with 'payer' parameter
export type RepoDriverAbi = typeof repoDriverLegacyAbi | typeof repoDriverAbi;
