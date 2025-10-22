import type { Pool } from 'pg';
import type { Log } from 'viem';
import { SpanStatusCode } from '@opentelemetry/api';

import { logger } from '../logger.js';
import { withDbRetry } from '../utils/dbRetry.js';
import { getReorgLockId } from '../utils/advisoryLock.js';
import type { CursorRepository } from '../repositories/CursorRepository.js';
import type { EventRepository, InsertEventParams } from '../repositories/EventsRepository.js';
import type { BlockHashesRepository } from '../repositories/BlockHashesRepository.js';
import { getTracer, getMeter } from '../telemetry.js';

import type { RpcClient, BlockSummary } from './RpcClient.js';
import type { EventDecoder } from './EventDecoder.js';

const tracer = getTracer();
const meter = getMeter();

const eventsInsertedCounter = meter.createCounter('db.events.inserted', {
  description: 'Total number of raw events inserted into database',
});

/**
 * Minimum block hash window to maintain for reorg detection.
 * Aligned with MAX_REORG_DEPTH in ReorgDetector.
 */
const MIN_HASH_WINDOW = 100;
const HISTORIC_BLOCK_CHUNK_SIZE = 10;

type FetchResult = {
  fromBlock: bigint;
  toBlock: bigint;
  eventCount: number;
  logsLength: number;
};

/**
 * Fetches blocks and logs from blockchain, decodes events, and stores atomically.
 */
export class BlockFetcher {
  private readonly _pool: Pool;
  private readonly _schema: string;
  private readonly _chainId: string;
  private readonly _rpc: RpcClient;
  private readonly _decoder: EventDecoder;
  private readonly _fetchBatchSize: number;
  private readonly _insertChunkSize: number;
  private readonly _confirmations: number;
  private readonly _cursorRepo: CursorRepository;
  private readonly _eventsRepo: EventRepository;
  private readonly _blockHashesRepo: BlockHashesRepository;

  constructor(
    pool: Pool,
    schema: string,
    chainId: string,
    rpc: RpcClient,
    decoder: EventDecoder,
    fetchBatchSize: number,
    insertChunkSize: number,
    confirmations: number,
    cursorRepo: CursorRepository,
    eventsRepo: EventRepository,
    blockHashesRepo: BlockHashesRepository,
  ) {
    this._pool = pool;
    this._schema = schema;
    this._chainId = chainId;
    this._rpc = rpc;
    this._decoder = decoder;
    this._fetchBatchSize = fetchBatchSize;
    this._insertChunkSize = insertChunkSize;
    this._confirmations = confirmations;
    this._cursorRepo = cursorRepo;
    this._eventsRepo = eventsRepo;
    this._blockHashesRepo = blockHashesRepo;
  }

  /**
   * Fetches blocks, decodes logs, and stores events atomically.
   * Returns null if no new blocks to fetch.
   */
  async fetch(): Promise<FetchResult | null> {
    const span = tracer.startSpan('indexer.fetch', {
      attributes: {
        'chain.id': this._chainId,
        schema: this._schema,
      },
    });

    try {
      const endTimer = logger.startTimer('block_fetch');
      const latestBlock = await this._rpc.getLatestBlockNumber();
      const safeBlock = await this._rpc.getSafeBlockNumber(this._confirmations);

      const totalEvents = await withDbRetry(async () => {
        const client = await this._pool.connect();
        let transactionStarted: boolean = false;
        let eventCount: number = 0;
        let fromBlock: bigint;
        let toBlock: bigint;
        try {
          await client.query('BEGIN');
          transactionStarted = true;

          // Read cursor with FOR UPDATE lock to prevent race conditions.
          const cursor = await this._cursorRepo.getCursorForUpdate(client);
          if (!cursor) {
            throw new Error('Cursor not initialized');
          }

          if (cursor.fetchedToBlock >= safeBlock) {
            await client.query('COMMIT');
            transactionStarted = false;
            return null;
          }

          fromBlock = cursor.fetchedToBlock + 1n;
          const maxToBlock = fromBlock + BigInt(this._fetchBatchSize - 1);
          toBlock = maxToBlock < safeBlock ? maxToBlock : safeBlock;

          if (toBlock < fromBlock) {
            await client.query('COMMIT');
            transactionStarted = false;
            return null;
          }

          logger.debug('fetcher_started', {
            schema: this._schema,
            chain: this._chainId,
            fromBlock: fromBlock.toString(),
            toBlock: toBlock.toString(),
            safeBlock: safeBlock.toString(),
          });

          const rpcSpan = tracer.startSpan('indexer.fetch.rpc', {
            attributes: {
              'rpc.from_block': fromBlock.toString(),
              'rpc.to_block': toBlock.toString(),
            },
          });

          let logs: readonly Log[];
          let blockSummaries: readonly BlockSummary[];

          try {
            logs = await this._rpc.getLogs(this._decoder.contractAddresses, fromBlock, toBlock);
            blockSummaries = await this._collectBlockSummaries(logs, fromBlock, toBlock, safeBlock);

            rpcSpan.setAttribute('rpc.log_count', logs.length);
            rpcSpan.setAttribute('rpc.block_count', blockSummaries.length);
            rpcSpan.setStatus({ code: SpanStatusCode.OK });
          } finally {
            rpcSpan.end();
          }

          // Build timestamp map.
          const blockTimestampMap = new Map<bigint, Date>(
            blockSummaries.map((block) => [block.number, new Date(Number(block.timestamp) * 1000)]),
          );

          // Acquire advisory lock to prevent race with ReorgDetector.
          const lockId = getReorgLockId(this._schema, this._chainId);
          await client.query('SELECT pg_advisory_xact_lock($1)', [lockId]);

          // Store block hashes for any blocks we fetched.
          if (blockSummaries.length > 0) {
            const blockRecords = blockSummaries.map((block) => ({
              chainId: this._chainId,
              blockNumber: block.number,
              blockHash: block.hash,
            }));
            await this._blockHashesRepo.insertBlockHashes(client, blockRecords);
          }

          // Prune old block hashes no longer needed for reorg detection.
          // Keep max(MIN_HASH_WINDOW, 3x confirmations) to align with MAX_REORG_DEPTH safety limit.
          // Runs on every fetch to ensure cleanup even when caught up.
          const minHashWindow = Math.max(MIN_HASH_WINDOW, this._confirmations * 3);
          const pruneBeforeBlock = toBlock - BigInt(minHashWindow);
          if (pruneBeforeBlock > 0n) {
            await this._blockHashesRepo.deleteBlockHashesBefore(
              client,
              this._chainId,
              pruneBeforeBlock,
            );
          }

          const decodedEvents: InsertEventParams[] = [];

          for (const logItem of logs) {
            const decodeResult = this._decoder.decode(logItem);

            if (decodeResult.status === 'decoded') {
              const blockTimestamp = blockTimestampMap.get(decodeResult.event.blockNumber);
              if (!blockTimestamp) {
                throw new Error(`Missing timestamp for block ${decodeResult.event.blockNumber}`);
              }
              decodedEvents.push({
                ...decodeResult.event,
                blockTimestamp,
              });
              continue;
            }

            if (decodeResult.status === 'missing_handler') {
              logger.debug('fetcher_log_no_handler', {
                schema: this._schema,
                chain: this._chainId,
                blockNumber: logItem.blockNumber?.toString() ?? 'unknown',
                transactionHash: logItem.transactionHash ?? 'unknown',
                logIndex: logItem.logIndex ?? 'unknown',
                address: logItem.address,
                eventName: decodeResult.eventName,
              });
              continue;
            }

            // Only warn on actual errors, not expected skips.
            if (
              decodeResult.reason === 'decode_error' ||
              decodeResult.reason === 'missing_log_fields'
            ) {
              logger.warn('fetcher_log_decode_failed', {
                schema: this._schema,
                chain: this._chainId,
                blockNumber: logItem.blockNumber?.toString() ?? 'unknown',
                transactionHash: logItem.transactionHash ?? 'unknown',
                logIndex: logItem.logIndex ?? 'unknown',
                address: logItem.address,
                reason: decodeResult.reason,
                error: decodeResult.error ?? 'unknown',
              });
            }
          }

          if (decodedEvents.length > 0) {
            decodedEvents.sort((left, right) => {
              if (left.blockNumber !== right.blockNumber) {
                return left.blockNumber < right.blockNumber ? -1 : 1;
              }
              if (left.txIndex !== right.txIndex) {
                return left.txIndex - right.txIndex;
              }
              if (left.logIndex !== right.logIndex) {
                return left.logIndex - right.logIndex;
              }
              return 0;
            });

            for (
              let fromIndex = 0;
              fromIndex < decodedEvents.length;
              fromIndex += this._insertChunkSize
            ) {
              const chunk: InsertEventParams[] = decodedEvents.slice(
                fromIndex,
                fromIndex + this._insertChunkSize,
              );
              await this._eventsRepo.insertEvents(client, chunk);
              eventCount += chunk.length;
            }

            eventsInsertedCounter.add(decodedEvents.length, {
              'chain.id': this._chainId,
              schema: this._schema,
            });
          }

          await this._cursorRepo.advanceFetchedTo(client, toBlock);
          await client.query('COMMIT');
          transactionStarted = false;

          return { eventCount, fromBlock, toBlock, logsLength: logs.length };
        } catch (error) {
          if (transactionStarted) {
            try {
              await client.query('ROLLBACK');
            } catch (rollbackError) {
              logger.error('fetcher_rollback_failed', {
                schema: this._schema,
                chain: this._chainId,
                originalError: error instanceof Error ? error.message : String(error),
                rollbackError:
                  rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
              });
            }
          }

          const enrichedError =
            error instanceof Error
              ? new Error(
                  `Block fetch operation failed [${this._schema}/${this._chainId}]: ${error.message}`,
                  { cause: error },
                )
              : new Error(
                  `Block fetch operation failed [${this._schema}/${this._chainId}]: ${String(error)}`,
                );

          throw enrichedError;
        } finally {
          client.release();
        }
      });

      if (totalEvents === null) {
        endTimer();
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return null;
      }

      const safeNumberMax = BigInt(Number.MAX_SAFE_INTEGER);
      const canRepresentAsNumber =
        totalEvents.toBlock <= safeNumberMax &&
        totalEvents.fromBlock <= safeNumberMax &&
        safeBlock <= safeNumberMax;
      const progressPercent =
        safeBlock > 0n
          ? canRepresentAsNumber
            ? ((Number(totalEvents.toBlock) / Number(safeBlock)) * 100).toFixed(2)
            : 'N/A'
          : '0.00';

      const blockSpan = totalEvents.toBlock - totalEvents.fromBlock + 1n;
      const blockCount = blockSpan <= safeNumberMax ? Number(blockSpan) : blockSpan.toString();
      const hasEvents = totalEvents.eventCount > 0;

      logger.info('fetcher_complete', {
        schema: this._schema,
        chain: this._chainId,
        fromBlock: totalEvents.fromBlock.toString(),
        toBlock: totalEvents.toBlock.toString(),
        blockCount,
        safeBlock: safeBlock.toString(),
        latestBlock: latestBlock.toString(),
        progressPercent: `${progressPercent}%`,
        blocksRemaining: (safeBlock - totalEvents.toBlock).toString(),
        logsFetched: totalEvents.logsLength,
        eventsDecoded: totalEvents.eventCount,
        status: hasEvents ? 'events_found' : 'no_events_in_range',
        pool: {
          total: this._pool.totalCount,
          idle: this._pool.idleCount,
          waiting: this._pool.waitingCount,
        },
      });

      endTimer();

      span.setAttributes({
        'fetch.from_block': totalEvents.fromBlock.toString(),
        'fetch.to_block': totalEvents.toBlock.toString(),
        'fetch.block_range': Number(blockSpan),
        'fetch.events_decoded': totalEvents.eventCount,
        'fetch.events_inserted': totalEvents.eventCount,
      });
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();

      return {
        fromBlock: totalEvents.fromBlock,
        toBlock: totalEvents.toBlock,
        eventCount: totalEvents.eventCount,
        logsLength: totalEvents.logsLength,
      };
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      span.end();
      throw error;
    }
  }

  private async _collectBlockSummaries(
    logs: readonly Log[],
    fromBlock: bigint,
    toBlock: bigint,
    safeBlock: bigint,
  ): Promise<readonly BlockSummary[]> {
    const eventBlockNumbers: readonly bigint[] = Array.from(
      new Set(
        logs
          .map((logItem) => logItem.blockNumber)
          .filter((blockNumber): blockNumber is bigint => blockNumber !== null),
      ),
    );

    const minReorgWindow: number =
      this._confirmations === 0 ? MIN_HASH_WINDOW : this._confirmations;
    const reorgWindowStart: bigint = safeBlock - BigInt(minReorgWindow);
    const blockMap: Map<bigint, BlockSummary> = new Map();

    let remainingEventBlocks: readonly bigint[] = eventBlockNumbers;

    if (toBlock >= reorgWindowStart) {
      const contiguousStart: bigint = fromBlock >= reorgWindowStart ? fromBlock : reorgWindowStart;
      const contiguousBlocks: readonly BlockSummary[] = await this._rpc.getBlocksInRange(
        contiguousStart,
        toBlock,
      );

      for (const block of contiguousBlocks) {
        blockMap.set(block.number, block);
      }

      remainingEventBlocks = eventBlockNumbers.filter(
        (blockNumber) => blockNumber < contiguousStart,
      );
    }

    if (remainingEventBlocks.length > 0) {
      for (let index = 0; index < remainingEventBlocks.length; index += HISTORIC_BLOCK_CHUNK_SIZE) {
        const chunk = remainingEventBlocks.slice(index, index + HISTORIC_BLOCK_CHUNK_SIZE);
        const historicBlocks: readonly BlockSummary[] = await Promise.all(
          chunk.map((blockNumber) => this._rpc.getBlock(blockNumber)),
        );

        for (const block of historicBlocks) {
          blockMap.set(block.number, block);
        }
      }
    }

    return Array.from(blockMap.values());
  }
}
