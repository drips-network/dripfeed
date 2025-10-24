import type { ChainConfig } from '../loadChainConfig.js';
import * as c from '../contractConfigFactories.js';

export const sepoliaConfig = {
  chainId: 11155111,
  startBlock: 4416384,
  visibilityThresholdBlockNumber: 0,
  contracts: [
    c.drips('0x74A32a38D945b9527524900429b083547DeB9bF4'),
    c.nftDriver('0xdC773a04C0D6EFdb80E7dfF961B6a7B063a28B44'),
    c.repoDriverLegacy('0xa71bdf410D48d4AA9aE1517A69D7E1Ef0c179b2B'), // TODO: switch to latest repoDriver when available.
    c.addressDriver('0x70E1E1437AeFe8024B6780C94490662b45C3B567'),
    c.repoDeadlineDriver('0x4e576318213e3c9b436d0758a021a485c5d8b929'),
    c.repoSubAccountDriver('0x317400fd9dfdad78d53a34455d89beb8f03f90ee'),
    c.immutableSplitsDriver('0xC3C1955bb50AdA4dC8a55aBC6d4d2a39242685c1'),
  ],
} as const as ChainConfig;
