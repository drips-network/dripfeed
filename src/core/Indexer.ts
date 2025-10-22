import { Pool, types } from 'pg';
import { createPublicClient, http, type Chain } from 'viem';
import { SpanStatusCode } from '@opentelemetry/api';

import { logger } from '../logger.js';
import { sleep } from '../utils/sleep.js';
import { CursorRepository } from '../repositories/CursorRepository.js';
import { EventRepository } from '../repositories/EventsRepository.js';
import { BlockHashesRepository } from '../repositories/BlockHashesRepository.js';
import type { RuntimeConfig } from '../config.js';
import { validateSchemaName } from '../utils/sqlValidation.js';
import { Contracts } from '../services/Contracts.js';
import { MetadataService } from '../services/MetadataService.js';
import { CacheInvalidationService } from '../services/CacheInvalidationService.js';
import { getTracer, getMeter } from '../telemetry.js';

import { RpcClient } from './RpcClient.js';
import { BlockFetcher } from './BlockFetcher.js';
import type { ContractConfig } from './EventDecoder.js';
import { EventDecoder } from './EventDecoder.js';
import { EventProcessor } from './EventProcessor.js';
import { LockManager } from './LockManager.js';
import { ReorgDetector } from './ReorgDetector.js';

const tracer = getTracer();
const meter = getMeter();

const reorgsCounter = meter.createCounter('indexer.reorgs.detected', {
  description: 'Total number of reorgs detected',
});

/**
 * Blockchain event indexer with ordered processing.
 */
export class Indexer {
  private readonly _config: RuntimeConfig;
  private readonly _pool: Pool;
  private readonly _chainId: string;
  private readonly _schema: string;
  private readonly _lockManager: LockManager;
  private readonly _reorgDetector: ReorgDetector;
  private readonly _fetcher: BlockFetcher;
  private readonly _processor: EventProcessor;
  private readonly _cursorRepo: CursorRepository;
  private _shouldStop = false;
  private _stoppedPromise: Promise<void> | null = null;
  private _resolveStoppedPromise: (() => void) | null = null;

  constructor(
    config: RuntimeConfig,
    pool: Pool,
    lockManager: LockManager,
    reorgDetector: ReorgDetector,
    fetcher: BlockFetcher,
    processor: EventProcessor,
    cursorRepo: CursorRepository,
  ) {
    this._config = config;
    this._pool = pool;
    this._chainId = String(config.chain.id);
    this._schema = validateSchemaName(config.database.schema);
    this._lockManager = lockManager;
    this._reorgDetector = reorgDetector;
    this._fetcher = fetcher;
    this._processor = processor;
    this._cursorRepo = cursorRepo;
  }

  /**
   * Starts the indexer loop with advisory lock.
   * Continuously fetches blocks, detects reorgs, and processes events.

  * **IMPORTANT**: This architecture is designed for **SINGLE INDEXER PER CHAIN** and **ONE SCHEMA PER CHAIN**.
   */
  async start(): Promise<void> {
    await this._lockManager.acquire();

    this._stoppedPromise = new Promise((resolve) => {
      this._resolveStoppedPromise = resolve;
    });

    try {
      await this._initializeCursor();

      logger.info('indexer_started', {
        schema: this._schema,
        chain: this._chainId,
      });

      let consecutiveErrors = 0;
      const baseBackoffMs = Math.max(this._config.indexer.pollDelay, 1000);
      const maxConsecutiveErrors = this._config.indexer.maxConsecutiveErrors;

      while (!this._shouldStop) {
        const span = tracer.startSpan('indexer.iteration', {
          attributes: {
            'chain.id': this._chainId,
            schema: this._schema,
            consecutive_errors: consecutiveErrors,
          },
        });

        try {
          logger.debug('indexer_loop_iteration', {
            schema: this._schema,
            chain: this._chainId,
            consecutiveErrors,
          });

          const reorgBlock = await this._reorgDetector.detect();
          if (reorgBlock !== null) {
            reorgsCounter.add(1, {
              'chain.id': this._chainId,
              schema: this._schema,
            });

            const reorgSpan = tracer.startSpan('indexer.reorg.handle', {
              attributes: {
                'reorg.block_number': reorgBlock.toString(),
                'reorg.auto_recovery': this._config.indexer.autoHandleReorgs,
              },
            });

            try {
              if (this._config.indexer.autoHandleReorgs) {
                logger.warn('reorg_auto_recovery_triggered', {
                  schema: this._schema,
                  chain: this._chainId,
                  reorgBlock: reorgBlock.toString(),
                  message: 'Auto-recovery enabled. Attempting reorg recovery...',
                });

                await this._reorgDetector.handleReorg(reorgBlock);

                logger.info('reorg_auto_recovery_success', {
                  schema: this._schema,
                  chain: this._chainId,
                  reorgBlock: reorgBlock.toString(),
                  message: 'Reorg recovery completed. Resuming indexing...',
                });

                reorgSpan.setStatus({ code: SpanStatusCode.OK });
                span.setAttribute('iteration.result', 'reorg_recovered');
              } else {
                const errorMsg = `🚨 REORG DETECTED at block ${reorgBlock} 🚨\n\nAuto-recovery is DISABLED (AUTO_HANDLE_REORGS=false).\n\nTo recover, you must:\n1. Stop this indexer immediately\n2. Run the rollback script:\n   npm run rollback -- --block ${reorgBlock}\n3. Restart the indexer\n\nIndexer will now exit to prevent data corruption.`;

                logger.error('reorg_manual_recovery_required', {
                  schema: this._schema,
                  chain: this._chainId,
                  reorgBlock: reorgBlock.toString(),
                  autoHandleReorgs: false,
                  message: errorMsg,
                });

                reorgSpan.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: 'Manual recovery required',
                });
                span.setAttribute('iteration.result', 'reorg_detected');

                throw new Error(errorMsg);
              }
            } finally {
              reorgSpan.end();
            }
          }

          const fetchResult = await this._fetcher.fetch();
          await this._processor.processBatch();

          consecutiveErrors = 0;

          span.setAttribute('iteration.result', 'success');
          span.setStatus({ code: SpanStatusCode.OK });

          if (!fetchResult) {
            await sleep(this._config.indexer.pollDelay);
          }
        } catch (error) {
          consecutiveErrors += 1;

          const normalizedError = error instanceof Error ? error : new Error(String(error));
          const backoffFactor = Math.min(consecutiveErrors, 5);
          const backoffMs = Math.min(baseBackoffMs * backoffFactor, 60000);

          span.setAttribute('iteration.result', 'error');
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: normalizedError.message,
          });
          span.recordException(normalizedError);

          logger.error('indexer_loop_error', {
            schema: this._schema,
            chain: this._chainId,
            backoffMs,
            consecutiveErrors,
            error: normalizedError.message,
            stack: normalizedError.stack,
          });

          if (consecutiveErrors >= maxConsecutiveErrors) {
            logger.error('indexer_max_consecutive_errors_exceeded', {
              schema: this._schema,
              chain: this._chainId,
              consecutiveErrors,
              error: normalizedError.message,
            });

            throw normalizedError;
          }

          await sleep(backoffMs);
        } finally {
          span.end();
        }
      }
    } finally {
      await this._lockManager.release();
      this._resolveStoppedPromise?.();
    }
  }

  /**
   * Gracefully stops the indexer loop and waits for it to finish.
   */
  async stop(): Promise<void> {
    this._shouldStop = true;
    logger.info('indexer_stop_requested', {
      schema: this._schema,
      chain: this._chainId,
    });
    await this._stoppedPromise;
  }

  /**
   * Initializes and validates the cursor in a transaction.
   */
  private async _initializeCursor(): Promise<void> {
    // -1 because fetchedToBlock tracks the last fetched block, so fetcher starts from fetchedToBlock + 1.
    const startBlock = BigInt(this._config.chain.startBlock - 1);

    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      await this._cursorRepo.initializeCursor(client, startBlock);

      // Validate cursor against DB after initialization.
      const cursor = await this._cursorRepo.getCursorForUpdate(client);
      if (!cursor) {
        throw new Error(`Cursor not initialized for chain ${this._chainId}`);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * Creates an Indexer instance.
 *
 * **IMPORTANT**: Only one instance of `Indexer` should exist per chain, with one schema per chain.
 */
export function createIndexer(
  config: RuntimeConfig,
  contracts: ReadonlyArray<ContractConfig> = [],
): {
  indexer: Indexer;
  pool: Pool;
  rpc: RpcClient;
  cursorRepo: CursorRepository;
  chainId: string;
} {
  // Configure pg to parse bigint/bigserial columns as BigInt instead of string.
  types.setTypeParser(types.builtins.INT8, (val: string) => BigInt(val));

  const pool = new Pool({
    connectionString: config.database.url,
  });

  const schema = validateSchemaName(config.database.schema);
  const chainId = String(config.chain.id);

  const client = createPublicClient({
    chain: { id: config.chain.id } as Chain,
    transport: http(config.chain.rpcUrl, {
      timeout: 30000,
    }),
  });

  const rpc = new RpcClient(client, {
    chainId: config.chain.id,
    concurrency: config.indexer.rpcConcurrency,
  });

  const contractService = new Contracts(client, contracts);
  const metadataService = new MetadataService(config.ipfs.gatewayUrl);
  const cacheInvalidationService = new CacheInvalidationService(config.cache.invalidationEndpoint);
  const lockManager = new LockManager(pool, schema, chainId);
  const decoder = new EventDecoder(chainId, schema, contracts);
  const cursorRepo = new CursorRepository(schema, chainId);
  const eventsRepo = new EventRepository(schema, chainId);
  const blockHashesRepo = new BlockHashesRepository(pool, schema);
  const reorgDetector = new ReorgDetector(
    pool,
    schema,
    chainId,
    rpc,
    BigInt(config.chain.startBlock),
    config.chain.confirmations,
    config.indexer.autoHandleReorgs,
    cursorRepo,
    eventsRepo,
    blockHashesRepo,
  );
  const fetcher = new BlockFetcher(
    pool,
    schema,
    chainId,
    rpc,
    decoder,
    config.indexer.fetchBatchSize,
    config.indexer.insertChunkSize,
    config.chain.confirmations,
    cursorRepo,
    eventsRepo,
    blockHashesRepo,
  );
  const processor = new EventProcessor(
    pool,
    schema,
    chainId,
    decoder,
    config.indexer.processBatchSize,
    eventsRepo,
    metadataService,
    contractService,
    cacheInvalidationService,
    BigInt(config.chain.visibilityThresholdBlockNumber),
  );

  const indexer = new Indexer(
    config,
    pool,
    lockManager,
    reorgDetector,
    fetcher,
    processor,
    cursorRepo,
  );

  return { indexer, pool, rpc, cursorRepo, chainId };
}
