import type * as mainnet from './mainnet.js';

// Union types for ABIs across all supported chains.
// This file is validated at startup by scripts/validate-chain-configs.ts to ensure
// all chain config files are properly imported and registered in the union types.
// When adding a new chain: import it and extend the union types below.

export type DripsAbi = typeof mainnet.dripsAbi;
export type NftDriverAbi = typeof mainnet.nftDriverAbi;
export type RepoDriverAbi = typeof mainnet.repoDriverAbi;
export type AddressDriverAbi = typeof mainnet.addressDriverAbi;
export type RepoSubAccountDriverAbi = typeof mainnet.repoSubAccountDriverAbi;
