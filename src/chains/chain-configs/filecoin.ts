import type { ChainConfig } from '../loadChainConfig.js';
import * as c from '../contractConfigFactories.js';

export const filecoinConfig = {
  chainId: 314,
  startBlock: 4342170,
  visibilityThresholdBlockNumber: 4502829,
  contracts: [
    c.drips('0xd320F59F109c618b19707ea5C5F068020eA333B3'),
    c.nftDriver('0x2F23217A87cAf04ae586eed7a3d689f6C48498dB'),
    c.repoDriver('0xe75f56B26857cAe06b455Bfc9481593Ae0FB4257'),
    c.addressDriver('0x04693D13826a37dDdF973Be4275546Ad978cb9EE'),
    c.repoDeadlineDriver('0x0386b66e2b0106ff27ef26e84102ca78a5c0edef'),
    c.repoSubAccountDriver('0x925a69f6d07ee4c753df139bcc2a946e1d1ee92a'),
    c.immutableSplitsDriver('0x96EC722e1338f08bbd469b80394eE118a0bc6753'),
  ],
} as const as ChainConfig;
