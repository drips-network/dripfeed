import { initTelemetry } from './telemetry.js';

initTelemetry();

const { config, runtimeConfigSchema } = await import('./config.js');
const { logger } = await import('./logger.js');
const { loadChainConfig } = await import('./chains/loadChainConfig.js');
const { logStartup: logRuntimeConfig } = await import('./utils/logStartup.js');
const { createIndexer } = await import('./core/Indexer.js');
const { createHealthServer } = await import('./health.js');

logger.setPrettyFormat(config.logging.pretty).setMinLevel(config.logging.level);

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
    process.exit(signal === 'ERROR' ? 1 : 0);
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
    // Indexer stopped gracefully (should not happen in normal operation).
    logger.info('indexer_stopped_unexpectedly');
    await shutdown('NORMAL_EXIT');
  } catch (err) {
    const error = err as Error;
    logger.error('indexer_start_failed', { error: error.message, stack: error.stack });
    await shutdown('ERROR');
  }
})();
