import type { Pool, PoolClient } from 'pg';

import type { CursorRepository } from '../repositories/CursorRepository.js';
import type { EventRepository } from '../repositories/EventsRepository.js';
import type { BlockHashesRepository } from '../repositories/BlockHashesRepository.js';
import { validateSchemaName, validateIdentifier } from '../utils/sqlValidation.js';
import { logger } from '../logger.js';
import { getReorgLockId } from '../utils/advisoryLock.js';

import type { RpcClient } from './RpcClient.js';

/**
 * Maximum reorg depth to prevent unbounded backwards search.
 * If a reorg exceeds this depth, the detector will fail fast.
 * Set to 100 blocks as a reasonable limit for most chains.
 * This value aligns with MIN_HASH_WINDOW in BlockFetcher.
 */
const MAX_REORG_DEPTH = 100;

/**
 * Detects blockchain reorganizations.
 */
export class ReorgDetector {
  private readonly _pool: Pool;
  private readonly _schema: string;
  private readonly _chainId: string;
  private readonly _rpc: RpcClient;
  private readonly _startBlock: bigint;
  private readonly _confirmations: number;
  private readonly _autoHandleReorgs: boolean;
  private readonly _cursorRepo: CursorRepository;
  private readonly _eventsRepo: EventRepository;
  private readonly _blockHashesRepo: BlockHashesRepository;

  constructor(
    pool: Pool,
    schema: string,
    chainId: string,
    rpc: RpcClient,
    startBlock: bigint,
    confirmations: number,
    autoHandleReorgs: boolean,
    cursorRepo: CursorRepository,
    eventsRepo: EventRepository,
    blockHashesRepo: BlockHashesRepository,
  ) {
    this._pool = pool;
    this._schema = validateSchemaName(schema);
    this._chainId = chainId;
    this._rpc = rpc;
    this._startBlock = startBlock;
    this._confirmations = confirmations;
    this._autoHandleReorgs = autoHandleReorgs;
    this._cursorRepo = cursorRepo;
    this._eventsRepo = eventsRepo;
    this._blockHashesRepo = blockHashesRepo;
  }

  /**
   * Detects reorgs by comparing stored hashes against current chain state.
   * Scans backwards from the cursor (up to MAX_REORG_DEPTH) until hashes realign.
   * Returns the earliest reorg block number if detected, null otherwise.
   */
  async detect(): Promise<bigint | null> {
    const endTimer = logger.startTimer('reorg_detection');
    const cursor = await this._cursorRepo.getCursor(this._pool);
    if (!cursor) {
      endTimer();
      return null;
    }

    const tail = cursor.fetchedToBlock;
    const maxLookback = tail >= BigInt(MAX_REORG_DEPTH - 1)
      ? tail - BigInt(MAX_REORG_DEPTH - 1)
      : this._startBlock;
    const scanFrom =
      maxLookback > this._startBlock ? maxLookback : this._startBlock;

    logger.debug('reorg_detection_started', {
      schema: this._schema,
      chain: this._chainId,
      checkFrom: scanFrom.toString(),
      checkTo: tail.toString(),
    });

    const storedHashes = await this._getStoredBlockHashes(scanFrom, tail);
    if (storedHashes.size === 0) {
      endTimer();
      return null;
    }

    const currentBlocks = await this._rpc.getBlocksInRange(scanFrom, tail);
    const currentMap = new Map<bigint, string>();
    for (const block of currentBlocks) {
      currentMap.set(block.number, block.hash);
    }

    let earliestReorgBlock: bigint | null = null;

    for (
      let blockNumber = tail;
      blockNumber >= scanFrom && blockNumber >= this._startBlock;
      blockNumber -= 1n
    ) {
      const storedHash = storedHashes.get(blockNumber);
      if (!storedHash) {
        break;
      }

      const currentHash = currentMap.get(blockNumber);
      if (!currentHash) {
        break;
      }

      if (currentHash !== storedHash) {
        logger.warn('reorg_hash_mismatch', {
          schema: this._schema,
          chain: this._chainId,
          block: blockNumber.toString(),
          storedHash,
          currentHash,
          windowFrom: scanFrom.toString(),
          windowTo: tail.toString(),
          confirmations: this._confirmations,
        });

        earliestReorgBlock = blockNumber;
      } else if (earliestReorgBlock !== null) {
        break;
      }
    }

    endTimer();

    if (earliestReorgBlock !== null) {
      const detectedDepth = tail - earliestReorgBlock;
      if (detectedDepth > BigInt(MAX_REORG_DEPTH)) {
        const errorMsg = `Reorg depth exceeds safety limit of ${MAX_REORG_DEPTH} blocks. Detected depth: ${detectedDepth}. This may indicate a critical chain issue or misconfiguration.`;
        logger.error('reorg_depth_exceeded', {
          schema: this._schema,
          chain: this._chainId,
          reorgDepth: detectedDepth.toString(),
          maxDepth: MAX_REORG_DEPTH,
          tail: tail.toString(),
          earliestReorgBlock: earliestReorgBlock.toString(),
        });
        throw new Error(errorMsg);
      }

      if (this._autoHandleReorgs) {
        logger.warn('reorg_detected', {
          schema: this._schema,
          chain: this._chainId,
          earliestReorgBlock: earliestReorgBlock.toString(),
          autoHandleReorgs: true,
          message: 'Reorg detected. Auto-recovery enabled.',
        });
      } else {
        logger.error('reorg_detected', {
          schema: this._schema,
          chain: this._chainId,
          earliestReorgBlock: earliestReorgBlock.toString(),
          autoHandleReorgs: false,
          message:
            '🚨 Chain reorg detected but auto-recovery is DISABLED — indexer may produce inconsistent data until reorg is resolved 🚨',
        });
      }
    }

    return earliestReorgBlock;
  }

  /**
   * Handles reorg recovery by atomically cleaning up affected data.
   * Acquires advisory lock, deletes events and block hashes from reorg block onwards,
   * and resets cursor to reorgBlock - 1.
   *
   * This method must be called within a transaction or will create its own.
   * Advisory lock prevents concurrent fetch operations during cleanup.
   */
  async handleReorg(reorgBlock: bigint): Promise<void> {
    const lockId = getReorgLockId(this._schema, this._chainId);
    const client = await this._pool.connect();

    try {
      await client.query('BEGIN');

      logger.info('reorg_recovery_started', {
        schema: this._schema,
        chain: this._chainId,
        reorgBlock: reorgBlock.toString(),
        lockId: lockId.toString(),
      });

      // Acquire advisory lock to prevent concurrent operations.
      const lockResult = await client.query<{ pg_try_advisory_xact_lock: boolean }>(
        'SELECT pg_try_advisory_xact_lock($1)',
        [lockId.toString()],
      );

      if (!lockResult.rows[0]?.pg_try_advisory_xact_lock) {
        throw new Error(
          `Failed to acquire reorg advisory lock for schema=${this._schema}, chain=${this._chainId}. Another reorg recovery may be in progress.`,
        );
      }

      // Calculate target cursor position (reorgBlock - 1).
      // The cursor is initialized to startBlock - 1, so we allow rewinding to that position.
      const targetCursor = reorgBlock - 1n;
      const minAllowedCursor = this._startBlock - 1n;
      if (targetCursor < minAllowedCursor) {
        throw new Error(
          `Reorg block ${reorgBlock} would rewind cursor to ${targetCursor}, which is below the minimum allowed cursor position ${minAllowedCursor} (startBlock - 1). This indicates a critical chain issue.`,
        );
      }

      // Delete events from reorg block onwards.
      // Block hashes and cursor must be handled together to maintain consistency.
      const eventsExist = await this._eventsRepo.hasEventsFromBlock(client, reorgBlock);
      if (eventsExist) {
        await this._eventsRepo.deleteEventsFromBlock(client, reorgBlock);
        logger.info('reorg_events_deleted', {
          schema: this._schema,
          chain: this._chainId,
          fromBlock: reorgBlock.toString(),
        });
      }

      // Delete event log tables from reorg block onwards.
      await this._deleteEventLogTables(client, reorgBlock);

      // Delete block hashes from reorg block onwards.
      const deletedHashCount = await this._blockHashesRepo.deleteBlockHashesFromBlock(
        client,
        this._chainId,
        reorgBlock,
      );
      logger.info('reorg_block_hashes_deleted', {
        schema: this._schema,
        chain: this._chainId,
        fromBlock: reorgBlock.toString(),
        deletedCount: deletedHashCount,
      });

      // Reset cursor to reorgBlock - 1.
      await this._cursorRepo.resetCursor(client, targetCursor);
      logger.info('reorg_cursor_reset', {
        schema: this._schema,
        chain: this._chainId,
        newCursor: targetCursor.toString(),
      });

      await client.query('COMMIT');

      logger.info('reorg_recovery_completed', {
        schema: this._schema,
        chain: this._chainId,
        reorgBlock: reorgBlock.toString(),
        newCursor: targetCursor.toString(),
        message: 'Reorg recovery completed successfully. Fetcher will resume from reorgBlock.',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      logger.error('reorg_recovery_failed', {
        schema: this._schema,
        chain: this._chainId,
        reorgBlock: reorgBlock.toString(),
        error: normalizedError.message,
        stack: normalizedError.stack,
      });
      throw normalizedError;
    } finally {
      client.release();
    }
  }

  /**
   * Deletes event log records from reorg block onwards.
   * Event log tables store immutable historical records of events and must be cleaned
   * during reorgs to maintain consistency with the canonical chain.
   *
   * Automatically discovers tables by querying for tables that:
   * - End with '_events' (but not the system table '_events' itself)
   * - Have a 'block_number' column
   */
  private async _deleteEventLogTables(client: PoolClient, reorgBlock: bigint): Promise<void> {
    // Discover event log tables from schema.
    const tablesResult = await client.query<{ table_name: string }>(
      `
      SELECT DISTINCT t.table_name
      FROM information_schema.tables t
      INNER JOIN information_schema.columns c
        ON t.table_schema = c.table_schema
        AND t.table_name = c.table_name
        AND c.column_name = 'block_number'
      WHERE t.table_schema = $1
        AND t.table_type = 'BASE TABLE'
        AND t.table_name LIKE '%\\_events'
        AND t.table_name != '_events'
      ORDER BY t.table_name
      `,
      [this._schema],
    );

    const eventLogTables = tablesResult.rows.map((row) => row.table_name);

    if (eventLogTables.length === 0) {
      logger.debug('reorg_no_event_log_tables', {
        schema: this._schema,
        chain: this._chainId,
        message: 'No event log tables found to clean up',
      });
      return;
    }

    logger.info('reorg_event_log_tables_discovered', {
      schema: this._schema,
      chain: this._chainId,
      tables: eventLogTables,
      count: eventLogTables.length,
    });

    for (const table of eventLogTables) {
      // Validate table name to prevent SQL injection.
      let validatedTable: string;
      try {
        validatedTable = validateIdentifier(table);
      } catch (error) {
        logger.warn('reorg_invalid_table_name_skipped', {
          schema: this._schema,
          chain: this._chainId,
          table,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const result = await client.query(
        `DELETE FROM ${this._schema}.${validatedTable} WHERE block_number >= $1`,
        [reorgBlock.toString()],
      );

      const deletedCount = result.rowCount || 0;
      if (deletedCount > 0) {
        logger.info('reorg_event_log_table_deleted', {
          schema: this._schema,
          chain: this._chainId,
          table: validatedTable,
          fromBlock: reorgBlock.toString(),
          deletedCount,
        });
      }
    }
  }

  /**
   * Retrieves stored block hashes for reorg detection.
   */
  private async _getStoredBlockHashes(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<Map<bigint, string>> {
    const result = await this._pool.query<{ block_number: string; block_hash: string }>(
      `SELECT block_number, block_hash FROM ${this._schema}._block_hashes WHERE chain_id = $1 AND block_number >= $2 AND block_number <= $3`,
      [this._chainId, fromBlock.toString(), toBlock.toString()],
    );
    const map = new Map<bigint, string>();
    for (const row of result.rows) {
      map.set(BigInt(row.block_number), row.block_hash);
    }
    return map;
  }
}
