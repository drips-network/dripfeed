import { addressDriverAbi } from './abis/addressDriverAbi.js';
import { dripsAbi } from './abis/dripsAbi.js';
import { nftDriverAbi } from './abis/nftDriverAbi.js';
import { repoDeadlineDriverAbi } from './abis/repoDeadlineDriverAbi.js';
import { repoDriverLegacyAbi } from './abis/repoDriverLegacyAbi.js';
import { repoSubAccountDriverAbi } from './abis/repoSubAccountDriverAbi.js';
import type { ChainConfig } from './loadChainConfig.js';

export const mainnetConfig = {
  chainId: 1,
  startBlock: 17684572,
  visibilityThresholdBlockNumber: 21335439,
  contracts: [
    {
      name: 'Drips',
      address: '0xd0dd053392db676d57317cd4fe96fc2ccf42d0b4',
      abi: dripsAbi,
      events: [
        'Given',
        'Split',
        'SplitsSet',
        'StreamsSet',
        'SqueezedStreams',
        'StreamReceiverSeen',
        'AccountMetadataEmitted',
      ],
    },
    {
      name: 'NftDriver',
      address: '0xcf9c49B0962EDb01Cdaa5326299ba85D72405258',
      abi: nftDriverAbi,
      events: ['Transfer'],
    },
    {
      name: 'RepoDriver',
      address: '0x770023d55D09A9C110694827F1a6B32D5c2b373E',
      abi: repoDriverLegacyAbi, // TODO: update to latest ABI when available
      events: ['OwnerUpdateRequested', 'OwnerUpdated'],
    },
    {
      name: 'AddressDriver',
      address: '0x1455d9bD6B98f95dd8FEB2b3D60ed825fcef0610',
      abi: addressDriverAbi,
      events: [],
    },
    {
      name: 'RepoDeadlineDriver',
      address: '0x8324ea3538f12895c941a625b7f15df2d7dbfdff',
      abi: repoDeadlineDriverAbi,
      events: [],
    },
    {
      name: 'RepoSubAccountDriver',
      address: '0xc219395880fa72e3ad9180b8878e0d39d144130b',
      abi: repoSubAccountDriverAbi,
      events: [],
    },
  ],
} as const as ChainConfig;
