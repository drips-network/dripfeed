import type { ChainConfig } from '../loadChainConfig.js';
import * as c from '../contractConfigFactories.js';

export const localtestnetConfig = {
  chainId: 1,
  startBlock: 1,
  visibilityThresholdBlockNumber: 21335439,
  contracts: [
    c.drips('0x7CBbD3FdF9E5eb359E6D9B12848c5Faa81629944'),
    c.nftDriver('0xf98e07d281Ff9b83612DBeF0A067d710716720eA'),
    c.repoDriver('0x971e08fc533d2A5f228c7944E511611dA3B56B24'), // TODO: switch to latest repoDriver when available.
    c.addressDriver('0x1707De7b41A3915F990A663d27AD3a952D50151d'),
    c.repoDeadlineDriver('0xFD9Aa049A4f3dC1a2CD3355Ce52A943418Fa54e3'),
    c.repoSubAccountDriver('0xB8743C2bB8DF7399273aa7EE4cE8d4109Bec327F'),
    c.immutableSplitsDriver('0x33a946e876C3bFb08636099238Db35a81dEf4b1E'),
  ],
} as const as ChainConfig;
