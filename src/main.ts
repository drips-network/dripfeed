import { createPublicClient, http, type Chain } from 'viem';

import { initTelemetry } from './telemetry.js';

initTelemetry();
const { config, runtimeConfigSchema } = await import('./config.js');
const { logger } = await import('./logger.js');
const { loadChainConfig } = await import('./chains/loadChainConfig.js');
const { logStartup: logRuntimeConfig } = await import('./utils/logStartup.js');
const { createIndexer } = await import('./core/Indexer.js');
const { createHealthServer } = await import('./health.js');
const { WatchedGiversRepository } = await import('./repositories/WatchedGiversRepository.js');
const { GiverWatcherService } = await import('./services/GiverWatcherService.js');

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

const watchedGiversRepo = runtimeConfig.giverWatcher.enabled
  ? new WatchedGiversRepository(runtimeConfig.database.schema)
  : undefined;

const healthServer = createHealthServer(
  pool,
  rpc,
  cursorRepo,
  chainId,
  config.network,
  runtimeConfig.health.port,
  watchedGiversRepo,
);

let giverWatcher: InstanceType<typeof GiverWatcherService> | undefined;
if (runtimeConfig.giverWatcher.enabled && watchedGiversRepo) {
  const watcherClient = createPublicClient({
    chain: {
      id: runtimeConfig.chain.id,
      contracts: {
        multicall3: {
          address: '0xcA11bde05977b3631167028862bE2a173976CA11' as const,
        },
      },
    } as Chain,
    transport: http(runtimeConfig.chain.rpcUrl, {
      timeout: 30000,
      fetchOptions: runtimeConfig.chain.rpcAccessToken
        ? {
            headers: {
              Authorization: `Bearer ${runtimeConfig.chain.rpcAccessToken}`,
            },
          }
        : undefined,
    }),
  });

  giverWatcher = new GiverWatcherService(pool, watcherClient, watchedGiversRepo, {
    pollIntervalMs: runtimeConfig.giverWatcher.pollIntervalMs,
    batchSize: runtimeConfig.giverWatcher.batchSize,
  });
  giverWatcher.start();
}

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
    // Stop giver watcher if running.
    giverWatcher?.stop();

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
