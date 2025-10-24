import { addressDriverAbi } from './abis/addressDriverAbi.js';
import { dripsAbi } from './abis/dripsAbi.js';
import { immutableSplitsDriverAbi } from './abis/immutableSplitsAbi.js';
import { nftDriverAbi } from './abis/nftDriverAbi.js';
import { repoDeadlineDriverAbi } from './abis/repoDeadlineDriverAbi.js';
import { repoDriverAbi } from './abis/repoDriverAbi.js';
import { repoDriverLegacyAbi } from './abis/repoDriverLegacyAbi.js';
import { repoSubAccountDriverAbi } from './abis/repoSubAccountDriverAbi.js';
import type { ChainConfig } from './loadChainConfig.js';
import {
  ADDRESS_DRIVER_EVENTS,
  DRIPS_EVENTS,
  IMMUTABLE_SPLITS_DRIVER_EVENTS,
  NFT_DRIVER_EVENTS,
  REPO_DEADLINE_DRIVER_EVENTS,
  REPO_DRIVER_EVENTS,
  REPO_SUB_ACCOUNT_DRIVER_EVENTS,
} from './monitoredEvents.js';

export const drips = (address: `0x${string}`): ChainConfig['contracts'][number] => ({
  name: 'Drips',
  address,
  abi: dripsAbi,
  events: DRIPS_EVENTS,
});

export const nftDriver = (address: `0x${string}`): ChainConfig['contracts'][number] => ({
  name: 'NftDriver',
  address,
  abi: nftDriverAbi,
  events: NFT_DRIVER_EVENTS,
});

export const repoDriver = (address: `0x${string}`): ChainConfig['contracts'][number] => ({
  name: 'RepoDriver',
  address,
  abi: repoDriverAbi,
  events: REPO_DRIVER_EVENTS,
});

export const repoDriverLegacy = (address: `0x${string}`): ChainConfig['contracts'][number] => ({
  name: 'RepoDriver',
  address,
  abi: repoDriverLegacyAbi,
  events: REPO_DRIVER_EVENTS,
});

export const addressDriver = (address: `0x${string}`): ChainConfig['contracts'][number] => ({
  name: 'AddressDriver',
  address,
  abi: addressDriverAbi,
  events: ADDRESS_DRIVER_EVENTS,
});

export const repoDeadlineDriver = (address: `0x${string}`): ChainConfig['contracts'][number] => ({
  name: 'RepoDeadlineDriver',
  address,
  abi: repoDeadlineDriverAbi,
  events: REPO_DEADLINE_DRIVER_EVENTS,
});

export const repoSubAccountDriver = (address: `0x${string}`): ChainConfig['contracts'][number] => ({
  name: 'RepoSubAccountDriver',
  address,
  abi: repoSubAccountDriverAbi,
  events: REPO_SUB_ACCOUNT_DRIVER_EVENTS,
});

export const immutableSplitsDriver = (
  address: `0x${string}`,
): ChainConfig['contracts'][number] => ({
  name: 'ImmutableSplitsDriver',
  address,
  abi: immutableSplitsDriverAbi,
  events: IMMUTABLE_SPLITS_DRIVER_EVENTS,
});
