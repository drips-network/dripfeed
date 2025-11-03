import type { Pool, PoolClient } from 'pg';
import { SpanStatusCode } from '@opentelemetry/api';

import { isTransientDbError, withDbRetry } from '../utils/dbRetry.js';
import { logger } from '../logger.js';
import type { EventRepository, Event as DbEvent } from '../repositories/EventsRepository.js';
import { DripListsRepository } from '../repositories/DripListsRepository.js';
import { EcosystemsRepository } from '../repositories/EcosystemsRepository.js';
import { LinkedIdentitiesRepository } from '../repositories/LinkedIdentitiesRepository.js';
import { PendingNftTransfersRepository } from '../repositories/PendingNftTransfersRepository.js';
import { ProjectsRepository } from '../repositories/ProjectsRepository.js';
import { SplitsRepository } from '../repositories/SplitsRepository.js';
import { SubListsRepository } from '../repositories/SubListsRepository.js';
import type { HandlerContext, HandlerEvent } from '../handlers/EventHandler.js';
import type { CacheInvalidationService } from '../services/CacheInvalidationService.js';
import type { MetadataService } from '../services/MetadataService.js';
import type { Contracts } from '../services/Contracts.js';
import { getTracer, getMeter } from '../telemetry.js';

import type { EventDecoder } from './EventDecoder.js';

const tracer = getTracer();
const meter = getMeter();

const eventsProcessedCounter = meter.createCounter('db.events.processed', {
  description: 'Total number of events successfully processed',
});
const eventsFailedCounter = meter.createCounter('db.events.failed', {
  description: 'Total number of events that failed processing',
});

export type ProcessResult = {
  blockNumber: bigint;
  txIndex: number;
  logIndex: number;
  eventName: string;
};

/**
 * Processes pending events sequentially with retry and backoff.
 */
export class EventProcessor {
  private readonly _pool: Pool;
  private readonly _schema: string;
  private readonly _chainId: string;
  private readonly _decoder: EventDecoder;
  private readonly _batchSize: number;
  private readonly _eventsRepo: EventRepository;
  private readonly _metadataService: MetadataService;
  private readonly _contracts: Contracts;
  private readonly _cacheInvalidationService: CacheInvalidationService;
  private readonly _visibilityThresholdBlockNumber: bigint;

  constructor(
    pool: Pool,
    schema: string,
    chainId: string,
    decoder: EventDecoder,
    batchSize: number,
    eventsRepo: EventRepository,
    metadataService: MetadataService,
    contracts: Contracts,
    cacheInvalidationService: CacheInvalidationService,
    visibilityThresholdBlockNumber: bigint,
  ) {
    this._pool = pool;
    this._schema = schema;
    this._chainId = chainId;
    this._decoder = decoder;
    this._batchSize = batchSize;
    this._eventsRepo = eventsRepo;
    this._metadataService = metadataService;
    this._contracts = contracts;
    this._cacheInvalidationService = cacheInvalidationService;
    this._visibilityThresholdBlockNumber = visibilityThresholdBlockNumber;
  }

  /**
   * Processes next pending event.
   * Returns null if no pending events, throws if worker should stop.
   */
  async processNext(): Promise<ProcessResult | null> {
    return withDbRetry(async () => {
      const client = await this._pool.connect();
      let event: DbEvent | null = null;
      try {
        await client.query('BEGIN');
        event = await this._eventsRepo.getNextPendingEvent(client);

        if (!event) {
          await client.query('ROLLBACK');
          return null;
        }

        const context = this._buildHandlerContext(client);
        const handler = this._decoder.resolveHandler(event.contractAddress, event.eventName);
        const handlerEvent = this._toHandlerEvent(event);

        logger.info('handler_executing', {
          schema: this._schema,
          chainId: this._chainId,
          eventName: event.eventName,
          handler: handler.name,
          pointer: this._formatEventPointer(event),
        });

        await handler(handlerEvent, context);

        logger.info('handler_completed', {
          schema: this._schema,
          chainId: this._chainId,
          eventName: event.eventName,
          handler: handler.name,
          pointer: this._formatEventPointer(event),
        });

        await this._eventsRepo.markEventProcessed(
          client,
          event.blockNumber,
          event.txIndex,
          event.logIndex,
        );

        await client.query('COMMIT');

        logger.debug('processor_event_processed', {
          schema: this._schema,
          chainId: this._chainId,
          pointer: this._formatEventPointer(event),
          event: event.eventName,
        });

        return {
          blockNumber: event.blockNumber,
          txIndex: event.txIndex,
          logIndex: event.logIndex,
          eventName: event.eventName,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        if (isTransientDbError(error)) {
          throw error;
        }
        if (event) {
          await this._handleProcessingFailure(event, error);
        }
        return null;
      } finally {
        client.release();
      }
    });
  }

  private async _executeHandler(event: DbEvent, context: HandlerContext): Promise<void> {
    const handler = this._decoder.resolveHandler(event.contractAddress, event.eventName);
    const handlerEvent = this._toHandlerEvent(event);

    logger.info('handler_executing', {
      schema: this._schema,
      chainId: this._chainId,
      eventName: event.eventName,
      handler: handler.name,
      pointer: this._formatEventPointer(event),
    });

    await handler(handlerEvent, context);

    logger.info('handler_completed', {
      schema: this._schema,
      chainId: this._chainId,
      eventName: event.eventName,
      handler: handler.name,
      pointer: this._formatEventPointer(event),
    });
  }

  /**
   * Builds handler context from database client.
   */
  private _buildHandlerContext(client: PoolClient): HandlerContext {
    return {
      client,
      schema: this._schema,
      projectsRepo: new ProjectsRepository(client, this._schema),
      linkedIdentitiesRepo: new LinkedIdentitiesRepository(client, this._schema),
      splitsRepo: new SplitsRepository(client, this._schema),
      dripListsRepo: new DripListsRepository(client, this._schema),
      ecosystemsRepo: new EcosystemsRepository(client, this._schema),
      subListsRepo: new SubListsRepository(client, this._schema),
      pendingNftTransfersRepo: new PendingNftTransfersRepository(client, this._schema),
      metadataService: this._metadataService,
      contracts: this._contracts,
      cacheInvalidationService: this._cacheInvalidationService,
      visibilityThresholdBlockNumber: this._visibilityThresholdBlockNumber,
    };
  }

  /**
   * Processes batch of pending events in single transaction.
   * Returns empty array if no pending events, throws if indexer should stop.
   * On failure, falls back to one-by-one processing to maintain retry logic.
   */
  async processBatch(): Promise<ProcessResult[]> {
    const span = tracer.startSpan('indexer.process_batch', {
      attributes: {
        'chain.id': this._chainId,
        schema: this._schema,
      },
    });

    try {
      const endTimer = logger.startTimer('event_batch_processing');
      return await withDbRetry(async () => {
        const client = await this._pool.connect();
        const events: DbEvent[] = [];
        const results: ProcessResult[] = [];

        try {
          await client.query('BEGIN');
          const batch = await this._eventsRepo.getNextPendingEventBatch(client, this._batchSize);

          if (batch.length === 0) {
            await client.query('ROLLBACK');
            endTimer();
            span.setAttribute('batch.size', 0);
            span.setStatus({ code: SpanStatusCode.OK });
            logger.debug('processor_no_pending_events', {
              schema: this._schema,
              chainId: this._chainId,
            });
            return [];
          }

          span.setAttribute('batch.size', batch.length);

          logger.info('processor_batch_started', {
            schema: this._schema,
            chainId: this._chainId,
            batchSize: batch.length,
            firstPointer: this._formatEventPointer(batch[0]!),
          });

          events.push(...batch);

          const context = this._buildHandlerContext(client);

          for (const event of batch) {
            await this._executeHandler(event, context);

            await this._eventsRepo.markEventProcessed(
              client,
              event.blockNumber,
              event.txIndex,
              event.logIndex,
            );

            results.push({
              blockNumber: event.blockNumber,
              txIndex: event.txIndex,
              logIndex: event.logIndex,
              eventName: event.eventName,
            });
          }

          await client.query('COMMIT');

          eventsProcessedCounter.add(batch.length, {
            'chain.id': this._chainId,
            schema: this._schema,
          });

          logger.info('processor_batch_processed', {
            schema: this._schema,
            chainId: this._chainId,
            eventsProcessed: batch.length,
            lastPointer: this._formatEventPointer(batch[batch.length - 1]!),
          });

          span.setAttribute('batch.processed_count', batch.length);
          span.setAttribute('batch.failed', false);
          span.setAttribute('batch.fallback_triggered', false);

          endTimer();
          return results;
        } catch (error) {
          await client.query('ROLLBACK');

          span.setAttribute('batch.failed', true);
          span.setAttribute('batch.fallback_triggered', true);

          logger.warn('processor_batch_failed_fallback_to_individual', {
            schema: this._schema,
            chainId: this._chainId,
            batchSize: events.length,
            firstPointer: events.length > 0 ? this._formatEventPointer(events[0]!) : 'unknown',
            lastPointer:
              events.length > 0 ? this._formatEventPointer(events[events.length - 1]!) : 'unknown',
            error: this._extractErrorMessage(error),
          });

          const fallbackResults: ProcessResult[] = [];
          for (const event of events) {
            const result = await this._processEvent(event);
            if (result) {
              fallbackResults.push(result);
            }
          }

          span.setAttribute('batch.processed_count', fallbackResults.length);

          endTimer();
          return fallbackResults;
        } finally {
          client.release();
        }
      });
    } finally {
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    }
  }

  /**
   * Processes specific event (no retry logic).
   * Returns null if processing fails and marks event as failed immediately.
   */
  private async _processEvent(event: DbEvent): Promise<ProcessResult | null> {
    const span = tracer.startSpan('indexer.process_event', {
      attributes: {
        'event.name': event.eventName,
        'event.block_number': event.blockNumber.toString(),
      },
    });

    try {
      return await withDbRetry(async () => {
        const endTimer = logger.startTimer('event_processing');
        const client = await this._pool.connect();

        try {
          await client.query('BEGIN');

          const context = this._buildHandlerContext(client);

          await this._executeHandler(event, context);

          await this._eventsRepo.markEventProcessed(
            client,
            event.blockNumber,
            event.txIndex,
            event.logIndex,
          );

          await client.query('COMMIT');

          eventsProcessedCounter.add(1, {
            'chain.id': this._chainId,
            schema: this._schema,
          });

          logger.debug('processor_event_processed', {
            schema: this._schema,
            chainId: this._chainId,
            pointer: this._formatEventPointer(event),
            event: event.eventName,
          });

          span.setAttribute('event.status', 'processed');
          span.setStatus({ code: SpanStatusCode.OK });

          return {
            blockNumber: event.blockNumber,
            txIndex: event.txIndex,
            logIndex: event.logIndex,
            eventName: event.eventName,
          };
        } catch (error) {
          await client.query('ROLLBACK');
          if (isTransientDbError(error)) {
            throw error;
          }
          await this._handleProcessingFailure(event, error);
          span.setAttribute('event.status', 'failed');
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          if (error instanceof Error) {
            span.recordException(error);
          }
          return null;
        } finally {
          client.release();
          endTimer();
        }
      });
    } finally {
      span.end();
    }
  }

  /**
   * Converts database event to handler event format.
   */
  private _toHandlerEvent(event: DbEvent): HandlerEvent {
    return {
      chainId: event.chainId,
      blockNumber: event.blockNumber,
      blockTimestamp: event.blockTimestamp,
      txIndex: event.txIndex,
      logIndex: event.logIndex,
      txHash: event.transactionHash as `0x${string}`,
      blockHash: event.blockHash as `0x${string}`,
      contractAddress: event.contractAddress as `0x${string}`,
      eventName: event.eventName,
      eventSig: event.eventSig as `0x${string}`,
      args: event.args,
    };
  }

  /**
   * Handles event failure by marking event as failed.
   */
  private async _handleProcessingFailure(event: DbEvent, error: unknown): Promise<void> {
    const errorMessage = this._extractErrorMessage(error);
    const client = await this._pool.connect();

    try {
      await client.query('BEGIN');

      await this._eventsRepo.markEventFailed(
        client,
        event.blockNumber,
        event.txIndex,
        event.logIndex,
        errorMessage,
      );

      await client.query('COMMIT');

      eventsFailedCounter.add(1, {
        'chain.id': this._chainId,
        schema: this._schema,
      });

      logger.error('processor_event_failed', {
        schema: this._schema,
        chainId: this._chainId,
        pointer: this._formatEventPointer(event),
        eventName: event.eventName,
        error: errorMessage,
      });
    } catch (dbError) {
      await client.query('ROLLBACK');
      throw dbError;
    } finally {
      client.release();
    }
  }

  /**
   * Formats event pointer as block:tx:log for logging.
   */
  private _formatEventPointer(event: DbEvent): string {
    return `${event.blockNumber}:${event.txIndex}:${event.logIndex}`;
  }

  /**
   * Extracts error message from unknown error type.
   */
  private _extractErrorMessage(error: unknown): string {
    if (error instanceof Error && typeof error.message === 'string') {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    try {
      return JSON.stringify(error, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
    } catch {
      return String(error);
    }
  }
}
