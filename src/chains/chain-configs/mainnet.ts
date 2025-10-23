import type { ChainConfig } from '../loadChainConfig.js';
import * as c from '../contractConfigFactories.js';

export const mainnetConfig = {
  chainId: 1,
  startBlock: 17684572,
  visibilityThresholdBlockNumber: 21335439,
  contracts: [
    c.drips('0xd0dd053392db676d57317cd4fe96fc2ccf42d0b4'),
    c.nftDriver('0xcf9c49B0962EDb01Cdaa5326299ba85D72405258'),
    c.repoDriverLegacy('0x770023d55D09A9C110694827F1a6B32D5c2b373E'), // TODO: switch to latest repoDriver when available.
    c.addressDriver('0x1455d9bD6B98f95dd8FEB2b3D60ed825fcef0610'),
    c.repoDeadlineDriver('0x8324ea3538f12895c941a625b7f15df2d7dbfdff'),
    c.repoSubAccountDriver('0xc219395880fa72e3ad9180b8878e0d39d144130b'),
  ],
} as const as ChainConfig;
