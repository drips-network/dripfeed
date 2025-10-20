import { config, runtimeConfigSchema } from './config.js';
import { logger } from './logger.js';
import { loadChainConfig } from './chain-configs/loadChainConfig.js';
import { logRuntimeConfig } from './utils/logRuntimeConfig.js';
import { createIndexer } from './core/Indexer.js';

logger.setMinLevel(config.logging.level);

const chainConfig = loadChainConfig(config.network);

// Merge chain-specific config into env config for runtime use.
const runtimeConfig = runtimeConfigSchema.parse({
  ...config,
  chain: {
    ...config.chain,
    id: chainConfig.chainId,
    startBlock: chainConfig.startBlock,
    visibilityThresholdBlockNumber: chainConfig.visibilityThresholdBlockNumber,
  },
});

logRuntimeConfig(runtimeConfig, chainConfig.contractConfigs);

const indexer = createIndexer(runtimeConfig, chainConfig.contractConfigs);

(async () => {
  try {
    await indexer.start();
  } catch (err) {
    const error = err as Error;
    logger.error('indexer_start_failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
})();
