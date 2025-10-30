import { config } from 'dotenv';
import { expand } from 'dotenv-expand';
import { Pool } from 'pg';

expand(config());

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
  BRIGHT: '\x1b[1m',
  NC: '\x1b[0m',
};

function formatDate(date: Date): string {
  return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

async function main(
  failedSinceHours: number,
  dbUrl: string,
  schema: string,
): Promise<void> {
  const pool = new Pool({ connectionString: dbUrl });

  try {
    console.log(`${COLORS.BLUE}=== Database Status ===${COLORS.NC}`);
    console.log(`Database: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`);
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

    // Get cursor status.
    const cursorResult = await pool.query<CursorRow>(
      `
      SELECT
        chain_id as "chainId",
        fetched_to_block as "fetchedToBlock",
        updated_at as "updatedAt"
      FROM ${schema}._cursor
    `,
    );

    if (cursorResult.rows.length > 0) {
      const cursor = cursorResult.rows[0]!;

      // Check if stalled.
      const staleMinutes = (Date.now() - cursor.updatedAt.getTime()) / 1000 / 60;
      if (staleMinutes > 5) {
        console.log(
          `${COLORS.YELLOW}⚠️  Warning: Cursor not updated in last ${Math.floor(staleMinutes)} minutes (indexer may be stalled)${COLORS.NC}`,
        );
        console.log('');
      }
    }

    // 1. Event Status Summary.
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

    // 2. Failed Events (if any).
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


    // 3. Processing Rate.
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

    // 4. Pending NFT Transfers.
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

    // 5. Database Statistics.
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

    // 6. Platform Stats.
    console.log(`${COLORS.BLUE}=== Platform Stats ===${COLORS.NC}`);
    const statsQuery = await pool.query<{
      claimedProjects: number;
      dripLists: number;
      totalSplits: number;
    }>(
      `
      SELECT
        (SELECT COUNT(*)::int
         FROM ${schema}.projects
         WHERE verification_status = 'claimed'
           AND is_valid = true) as "claimedProjects",
        (SELECT COUNT(*)::int
         FROM ${schema}.drip_lists
         WHERE is_valid = true) as "dripLists",
        (SELECT COUNT(*)::int
         FROM ${schema}.splits_receivers) as "totalSplits"
    `,
    );

    const platformStats = statsQuery.rows[0];
    if (platformStats) {
      console.log(`  Total claimed projects: ${COLORS.GREEN}${platformStats.claimedProjects}${COLORS.NC}`);
      console.log(`  Total drip lists: ${COLORS.GREEN}${platformStats.dripLists}${COLORS.NC}`);
      console.log(`  Total splits: ${COLORS.GREEN}${platformStats.totalSplits}${COLORS.NC}`);
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

// Parse named arguments.
function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg?.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith('--')) {
        args[key] = value;
        i++;
      }
    }
  }
  return args;
}

// Main execution.
const parsedArgs = parseArgs(process.argv.slice(2));

const failedSinceHours = parsedArgs.hours ? parseInt(parsedArgs.hours, 10) : 24;
const dbUrl = parsedArgs['db-url'] || process.env.DATABASE_URL;
const schema = parsedArgs.schema || process.env.DB_SCHEMA || 'public';

if (parsedArgs.hours && (isNaN(failedSinceHours) || failedSinceHours <= 0)) {
  console.error(`${COLORS.RED}Error: Hours parameter must be a positive number${COLORS.NC}`);
  process.exit(1);
}

if (!dbUrl) {
  console.error(
    `${COLORS.RED}Error: DATABASE_URL environment variable is not set and no --db-url argument provided${COLORS.NC}`,
  );
  console.error();
  console.error(`${COLORS.BRIGHT}Usage:${COLORS.NC}`);
  console.error(
    `  tsx scripts/db-status.ts [--hours N] [--db-url URL] [--schema SCHEMA]`,
  );
  console.error();
  console.error(`${COLORS.BRIGHT}Options:${COLORS.NC}`);
  console.error(`  --hours     Failed events window in hours (default: 24)`);
  console.error(`  --db-url    Database connection string (default: DATABASE_URL env)`);
  console.error(`  --schema    Schema to query (default: DB_SCHEMA env or 'public')`);
  console.error();
  console.error(`${COLORS.BRIGHT}Examples:${COLORS.NC}`);
  console.error(`  tsx scripts/db-status.ts`);
  console.error(`  tsx scripts/db-status.ts --hours 48`);
  console.error(
    `  tsx scripts/db-status.ts --db-url "postgresql://user:pass@host:5432/db" --schema optimism`,
  );
  console.error(
    `  npm run info:db -- --hours 24 --db-url "postgresql://..." --schema public`,
  );
  process.exit(1);
}

main(failedSinceHours, dbUrl, schema).catch((error: Error) => {
  console.error(`${COLORS.RED}Error:${COLORS.NC}`, error.message);
  process.exit(1);
});
