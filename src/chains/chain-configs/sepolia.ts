import type { ChainConfig } from '../loadChainConfig.js';
import * as c from '../contractConfigFactories.js';

export const sepoliaConfig = {
  chainId: 11155111,
  startBlock: 10381957, //10140802,
  visibilityThresholdBlockNumber: 0,
  contracts: [
    c.drips('0x2cd644bACE1926DeA14693c125F4751c9B25f661'),
    c.nftDriver('0x07418488D535fed8E765e9Ca993611BceA79af00'),
    c.repoDriver('0xE2111564E384d6D55D1Ce6e3dF5f2cfE24004DfA'),
    c.addressDriver('0xB77F6Ed18E58d4f9d4986F23BcE40fcb9ce3B05a'),
    c.repoDeadlineDriver('0x67672F910B9195F232beC4F4040a0F2d0218402c'),
    c.repoSubAccountDriver('0xA3F066e41DF5c0037ED67dA0a546bC9382B46fD1'),
    c.immutableSplitsDriver('0x8714cEFdd6e19f309dF4aEd3500994011cA9097C'),
  ],
} as const as ChainConfig;
