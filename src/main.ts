import { initTelemetry } from './telemetry.js';
import { config, runtimeConfigSchema } from './config.js';
import { logger } from './logger.js';
import { loadChainConfig } from './chain-configs/loadChainConfig.js';
import { logRuntimeConfig } from './utils/logRuntimeConfig.js';
import { createIndexer } from './core/Indexer.js';
import { createHealthServer } from './health.js';

initTelemetry();

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

const { indexer, pool, rpc, cursorRepo, chainId } = createIndexer(
  runtimeConfig,
  chainConfig.contractConfigs,
);

const healthServer = createHealthServer(pool, rpc, cursorRepo, chainId, runtimeConfig.health.port);

// Graceful shutdown handler.
let shutdownInProgress = false;
let poolClosed = false;
const closePool = async (): Promise<void> => {
  if (poolClosed) {
    return;
  }
  poolClosed = true;
  await pool.end();
};
const shutdown = async (signal: string): Promise<void> => {
  if (shutdownInProgress) {
    return;
  }
  shutdownInProgress = true;

  logger.info('shutdown_initiated', { signal });
  try {
    // Stop indexer loop and wait for it to finish.
    await indexer.stop();

    // Close health server.
    await new Promise<void>((resolve) => {
      healthServer.close((err) => {
        if (err) {
          logger.warn('health_server_close_error', {
            error: err.message,
            stack: err.stack,
          });
        }
        resolve();
      });
    });

    // Cleanup pool after indexer stops.
    await closePool();
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
    // Only cleanup if not already shutting down via signal handler.
    if (!shutdownInProgress) {
      healthServer.close(() => {
        // Ignore errors during cleanup.
      });
      await closePool();
    }
  }
})();
