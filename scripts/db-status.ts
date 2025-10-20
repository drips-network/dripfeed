import { Pool } from 'pg';
import { createPublicClient, http, type Chain } from 'viem';

import { config } from '../src/config.js';
import { loadChainConfig } from '../src/chain-configs/loadChainConfig.js';
import { RpcClient } from '../src/core/RpcClient.js';

interface CursorRow {
  chainId: string;
  fetchedToBlock: bigint;
  updatedAt: Date;
}

interface EventStatusRow {
  status: string;
  count: number;
  percentage: number;
}

interface FailedEventRow {
  pointer: string;
  eventName: string;
  errorPreview: string;
  updatedAt: Date;
  contractAddress: string;
  fullError: string;
}

interface ProcessingRateRow {
  lastHour: number;
  last15Min: number;
  last5Min: number;
}

interface DbStatsRow {
  eventsTableSize: string;
  totalEvents: number;
  blockHashesCached: number;
}

const COLORS = {
  RED: '\x1b[0;31m',
  YELLOW: '\x1b[1;33m',
  GREEN: '\x1b[0;32m',
  BLUE: '\x1b[0;34m',
  NC: '\x1b[0m',
};

function formatDate(date: Date): string {
  return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

async function main(): Promise<void> {
  const failedSinceHours = parseInt(process.argv[2] || '24', 10);
  if (isNaN(failedSinceHours) || failedSinceHours <= 0) {
    console.log(`${COLORS.RED}Error: Hours parameter must be a positive number${COLORS.NC}`);
    console.log(`Usage: tsx scripts/db-status.ts [hours] (default: 24)`);
    process.exit(1);
  }

  const schema = config.database.schema;
  const pool = new Pool({ connectionString: config.database.url });

  // Load chain config to get chain ID.
  const chainConfig = loadChainConfig(config.network);

  // Create RPC client for progress tracking.
  let rpcClient: RpcClient | null = null;
  try {
    const client = createPublicClient({
      chain: { id: chainConfig.chainId } as Chain,
      transport: http(config.chain.rpcUrl, {
        timeout: 10000,
      }),
    });
    rpcClient = new RpcClient(client, {
      chainId: chainConfig.chainId,
      timeout: 10000,
      retries: 2,
    });
  } catch (error) {
    console.log(
      `${COLORS.YELLOW}⚠️  Could not initialize RPC client (progress % unavailable)${COLORS.NC}`,
    );
    console.log(`${COLORS.YELLOW}    Error: ${error instanceof Error ? error.message : String(error)}${COLORS.NC}`);
  }

  try {
    console.log(`${COLORS.BLUE}=== Dripfeed Indexer Health Check ===${COLORS.NC}`);
    console.log(`Schema: ${schema}`);
    console.log(`Time: ${formatDate(new Date())}`);
    console.log(`Failed events window: last ${failedSinceHours}h`);
    console.log('');

    // Check database connection.
    try {
      await pool.query('SELECT 1');
    } catch (error) {
      console.log(`${COLORS.RED}❌ Cannot connect to database${COLORS.NC}`);
      console.error(error);
      process.exit(1);
    }

    // 1. Cursor Status.
    console.log(`${COLORS.BLUE}=== Indexing Progress ===${COLORS.NC}`);
    const cursorResult = await pool.query<CursorRow>(
      `
      SELECT
        chain_id as "chainId",
        fetched_to_block as "fetchedToBlock",
        updated_at as "updatedAt"
      FROM ${schema}._cursor
    `,
    );

    if (cursorResult.rows.length === 0) {
      console.log(`${COLORS.YELLOW}⚠️  No cursor found (indexer not initialized)${COLORS.NC}`);
    } else {
      const cursor = cursorResult.rows[0]!;
      console.log(`  Chain ID: ${cursor.chainId}`);
      console.log(`  Fetched to block: ${cursor.fetchedToBlock}`);

      // Try to get progress percentage.
      if (rpcClient) {
        try {
          const latestBlock = await rpcClient.getLatestBlockNumber();
          const progress = (Number(cursor.fetchedToBlock) / Number(latestBlock)) * 100;
          const progressColor =
            progress >= 100 ? COLORS.GREEN : progress > 99 ? COLORS.YELLOW : COLORS.RED;
          const blocksBehind = Number(latestBlock) - Number(cursor.fetchedToBlock);
          console.log(`  Latest chain block: ${latestBlock}`);
          console.log(
            `  Progress: ${progressColor}${progress.toFixed(4)}%${COLORS.NC} (${blocksBehind} blocks behind)`,
          );
        } catch (error) {
          console.log(`  ${COLORS.YELLOW}Progress: unavailable (RPC error)${COLORS.NC}`);
          console.log(`  ${COLORS.YELLOW}Error: ${error instanceof Error ? error.message : String(error)}${COLORS.NC}`);
        }
      }

      // Check if stalled.
      const staleMinutes = (Date.now() - cursor.updatedAt.getTime()) / 1000 / 60;
      if (staleMinutes > 5) {
        console.log(
          `${COLORS.YELLOW}  ⚠️  Warning: Cursor not updated in last ${Math.floor(staleMinutes)} minutes (indexer may be stalled)${COLORS.NC}`,
        );
      }
    }
    console.log('');

    // 2. Event Status Summary.
    console.log(`${COLORS.BLUE}=== Event Status Summary ===${COLORS.NC}`);
    const statusResult = await pool.query<EventStatusRow>(
      `
      SELECT
        status,
        COUNT(*)::int as count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
      FROM ${schema}._events
      GROUP BY status
      ORDER BY
        CASE status
          WHEN 'failed' THEN 1
          WHEN 'pending' THEN 2
          WHEN 'processed' THEN 3
        END
    `,
    );

    if (statusResult.rows.length === 0) {
      console.log('  No events found');
    } else {
      console.table(statusResult.rows);
    }

    const failedCount = statusResult.rows.find((r) => r.status === 'failed')?.count ?? 0;
    const pendingCount = statusResult.rows.find((r) => r.status === 'pending')?.count ?? 0;

    if (failedCount > 0) {
      console.log(`${COLORS.RED}❌ ${failedCount} permanently failed events detected${COLORS.NC}`);
    }

    if (pendingCount > 100) {
      console.log(
        `${COLORS.YELLOW}⚠️  ${pendingCount} pending events (may indicate processing lag)${COLORS.NC}`,
      );
    }
    console.log('');

    // 3. Failed Events (if any).
    if (failedCount > 0) {
      console.log(
        `${COLORS.BLUE}=== Recently Failed Events (last ${failedSinceHours}h) ===${COLORS.NC}`,
      );
      const failedResult = await pool.query<FailedEventRow>(
        `
        SELECT
          block_number || ':' || tx_index || ':' || log_index as pointer,
          event_name as "eventName",
          LEFT(error_message, 80) as "errorPreview",
          updated_at as "updatedAt",
          contract_address as "contractAddress",
          error_message as "fullError"
        FROM ${schema}._events
        WHERE status = 'failed'
          AND updated_at > NOW() - INTERVAL '${failedSinceHours} hours'
        ORDER BY updated_at DESC
        LIMIT 50
      `,
      );

      if (failedResult.rows.length === 0) {
        console.log(
          `  ${COLORS.GREEN}No failed events in the last ${failedSinceHours}h${COLORS.NC}`,
        );
      } else {
        // Show compact table first.
        const compactRows = failedResult.rows.map((row) => ({
          pointer: row.pointer,
          eventName: row.eventName,
          failedSince: formatDate(row.updatedAt),
          errorPreview: row.errorPreview,
        }));
        console.table(compactRows);
        console.log('');

        // Show detailed matrix with full error messages.
        console.log(`${COLORS.BLUE}=== Failed Events Details ===${COLORS.NC}`);
        for (const event of failedResult.rows) {
          console.log(`${COLORS.RED}● ${event.pointer}${COLORS.NC} - ${event.eventName}`);
          console.log(`  Contract: ${event.contractAddress}`);
          console.log(`  Failed since: ${formatDate(event.updatedAt)}`);
          console.log(`  Error: ${event.fullError}`);
          console.log('');
        }
      }
      console.log('');
    }


    // 4. Processing Rate.
    console.log(`${COLORS.BLUE}=== Processing Rate ===${COLORS.NC}`);
    const rateResult = await pool.query<ProcessingRateRow>(
      `
      SELECT
        COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '1 hour')::int as "lastHour",
        COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '15 minutes')::int as "last15Min",
        COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '5 minutes')::int as "last5Min"
      FROM ${schema}._events
      WHERE status = 'processed'
    `,
    );

    const rate = rateResult.rows[0];
    if (rate) {
      console.log(`  Last hour: ${rate.lastHour} events (${(rate.lastHour / 60).toFixed(1)}/min)`);
      console.log(
        `  Last 15 min: ${rate.last15Min} events (${(rate.last15Min / 15).toFixed(1)}/min)`,
      );
      console.log(`  Last 5 min: ${rate.last5Min} events (${(rate.last5Min / 5).toFixed(1)}/min)`);

      if (rate.last5Min < 5 && pendingCount > 0) {
        console.log(
          `${COLORS.YELLOW}  ⚠️  Warning: Low processing rate with pending events${COLORS.NC}`,
        );
      }
    }
    console.log('');

    // 5. Pending NFT Transfers.
    console.log(`${COLORS.BLUE}=== Pending NFT Transfers ===${COLORS.NC}`);
    const pendingNftResult = await pool.query<{ count: number; oldestBlockNumber: bigint | null }>(
      `
      SELECT
        COUNT(*)::int as count,
        MIN(block_number) as "oldestBlockNumber"
      FROM ${schema}._pending_nft_transfers
    `,
    );

    const pendingNft = pendingNftResult.rows[0];
    if (pendingNft) {
      console.log(`  Pending transfers: ${pendingNft.count}`);
      if (pendingNft.count > 0 && pendingNft.oldestBlockNumber !== null) {
        console.log(`  Oldest pending: block ${pendingNft.oldestBlockNumber}`);

        if (cursorResult.rows.length > 0) {
          const cursor = cursorResult.rows[0]!;
          const blocksBehind = cursor.fetchedToBlock - pendingNft.oldestBlockNumber;
          console.log(`  Age: ${blocksBehind} blocks behind cursor`);

          if (blocksBehind > 1000) {
            console.log(
              `${COLORS.YELLOW}  ⚠️  Warning: Old pending transfers detected (may indicate missing metadata)${COLORS.NC}`,
            );
          }
        }
      }
    }
    console.log('');

    // 6. Database Size.
    console.log(`${COLORS.BLUE}=== Database Statistics ===${COLORS.NC}`);
    const statsResult = await pool.query<DbStatsRow>(
      `
      SELECT
        pg_size_pretty(pg_total_relation_size('${schema}._events')) as "eventsTableSize",
        (SELECT COUNT(*)::int FROM ${schema}._events) as "totalEvents",
        (SELECT COUNT(*)::int FROM ${schema}._block_hashes) as "blockHashesCached"
    `,
    );

    const stats = statsResult.rows[0];
    if (stats) {
      console.log(`  Events table size: ${stats.eventsTableSize}`);
      console.log(`  Total events: ${stats.totalEvents}`);
      console.log(`  Block hashes cached: ${stats.blockHashesCached}`);
    }
    console.log('');

    // Summary.
    console.log(`${COLORS.BLUE}=== Health Summary ===${COLORS.NC}`);
    const stalledCursor =
      cursorResult.rows.length > 0 &&
      (Date.now() - cursorResult.rows[0]!.updatedAt.getTime()) / 1000 / 60 > 5;
    const lowRate = rate && rate.last5Min < 5;

    if (failedCount === 0 && !stalledCursor && !lowRate) {
      console.log(`${COLORS.GREEN}✓ Indexer is healthy${COLORS.NC}`);
    } else if (failedCount > 0 || stalledCursor) {
      console.log(`${COLORS.RED}✗ Issues detected - investigation needed${COLORS.NC}`);
      if (failedCount > 0) {
        console.log(`  - ${failedCount} failed events`);
      }
      if (stalledCursor) {
        console.log(`  - Stalled cursor (not updated recently)`);
      }
    } else {
      console.log(`${COLORS.YELLOW}⚠ Minor issues detected - monitor closely${COLORS.NC}`);
    }
  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
