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

const { indexer, cleanup } = createIndexer(runtimeConfig, chainConfig.contractConfigs);

// Graceful shutdown handler.
const shutdown = async (signal: string): Promise<void> => {
  logger.info('shutdown_initiated', { signal });
  try {
    await cleanup();
    logger.info('shutdown_complete', { signal });
    process.exit(0);
  } catch (err) {
    const error = err as Error;
    logger.error('shutdown_failed', { signal, error: error.message, stack: error.stack });
    process.exit(1);
  }
};

// Listen for termination signals.
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Start the indexer.
(async () => {
  try {
    await indexer.start();
  } catch (err) {
    const error = err as Error;
    logger.error('indexer_start_failed', { error: error.message, stack: error.stack });
    process.exit(1);
  } finally {
    await cleanup();
  }
})();
