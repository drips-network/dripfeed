/**
 * SCRIPT: Inspect Database Status
 *
 * Checks database and indexer health status including event processing rates,
 * failed events, pending transfers, and overall system health metrics.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';
import { Pool } from 'pg';

import { loadChainConfig } from '../src/chains/loadChainConfig.js';
import { validateSchemaName } from '../src/utils/sqlValidation.js';

import { configureScriptLogger } from './shared/configure-logger.js';
import { formatDate, formatNumber } from './shared/formatting.js';

// Configure logger for debug output.
configureScriptLogger();

interface StatusOptions {
  dbUrl: string;
  schema: string;
  network: string;
  hours: string;
}

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

async function checkStatus(options: StatusOptions): Promise<void> {
  const failedSinceHours = parseInt(options.hours, 10);

  // Load chain config from network name.
  const chainConfig = loadChainConfig(options.network);
  const chainId = String(chainConfig.chainId);

  // Display header.
  console.log(
    boxen(chalk.bold.blue('📊 DATABASE STATUS 📊'), {
      padding: 1,
      borderColor: 'blue',
      borderStyle: 'double',
    }),
  );
  console.log();

  // Display connection info.
  console.log(
    boxen(chalk.bold('Database Connection & Configuration'), {
      padding: 1,
      borderColor: 'blue',
      borderStyle: 'round',
    }),
  );
  console.log();

  const previewTable = new Table({
    colWidths: [25, 80],
    wordWrap: true,
    style: { head: [] },
  });

  previewTable.push(
    [chalk.cyan('Database URL'), options.dbUrl],
    [chalk.cyan('Schema'), chalk.bold(options.schema)],
    [chalk.cyan('Network'), chalk.bold(options.network)],
    [chalk.cyan('Chain ID'), chalk.bold(chainId)],
    [chalk.cyan('Time'), formatDate(new Date())],
    [chalk.cyan('Failed Events Window'), `${failedSinceHours} hours`],
  );

  console.log(previewTable.toString());
  console.log();

  const pool = new Pool({ connectionString: options.dbUrl });

  try {
    // Check database connection.
    await pool.query('SELECT 1');

    const schema = validateSchemaName(options.schema);

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

    // Validate schema/network compatibility.
    if (cursorResult.rows.length === 0) {
      console.log(
        boxen(chalk.bold.red(`❌ No cursor found in schema ${options.schema}`), {
          padding: 1,
          borderColor: 'red',
          borderStyle: 'round',
        }),
      );
      console.log();
      console.log(chalk.yellow('Possible issues:'));
      console.log(`  1. Schema not initialized yet`);
      console.log(`  2. Wrong schema name`);
      process.exit(1);
    }

    const cursor = cursorResult.rows[0]!;

    // Validate chain ID matches.
    if (cursor.chainId !== chainId) {
      console.log(
        boxen(
          chalk.bold.red(
            `❌ Chain ID mismatch: cursor has chain ${cursor.chainId}, but network ${options.network} is chain ${chainId}`,
          ),
          {
            padding: 1,
            borderColor: 'red',
            borderStyle: 'round',
          },
        ),
      );
      console.log();
      console.log(chalk.yellow('Network/schema mismatch (one schema per chain)'));
      process.exit(1);
    }

    // Check if stalled.
    const staleMinutes = (Date.now() - cursor.updatedAt.getTime()) / 1000 / 60;
    if (staleMinutes > 5) {
      console.log(
        chalk.yellow(
          `⚠️  Warning: Cursor not updated in last ${Math.floor(staleMinutes)} minutes (indexer may be stalled)`,
        ),
      );
      console.log();
    }

    // 1. Event Status Summary.
    console.log(
      boxen(chalk.bold('Event Status Summary'), {
        padding: 1,
        borderColor: 'cyan',
        borderStyle: 'round',
      }),
    );
    console.log();

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
      console.log(chalk.yellow('No events found'));
    } else {
      const statusTable = new Table({
        head: [chalk.cyan('Status'), chalk.cyan('Count'), chalk.cyan('Percentage')],
        style: { head: [] },
      });

      for (const row of statusResult.rows) {
        const statusColor =
          row.status === 'failed'
            ? chalk.red
            : row.status === 'pending'
              ? chalk.yellow
              : chalk.green;
        statusTable.push([statusColor(row.status), formatNumber(row.count), `${row.percentage}%`]);
      }

      console.log(statusTable.toString());
    }

    const failedCount = statusResult.rows.find((r) => r.status === 'failed')?.count ?? 0;
    const pendingCount = statusResult.rows.find((r) => r.status === 'pending')?.count ?? 0;

    if (failedCount > 0) {
      console.log();
      console.log(chalk.red(`❌ ${failedCount} permanently failed events detected`));
    }

    if (pendingCount > 100) {
      console.log();
      console.log(chalk.yellow(`⚠️  ${pendingCount} pending events (may indicate processing lag)`));
    }
    console.log();

    // 2. Failed Events (if any).
    if (failedCount > 0) {
      console.log(
        boxen(chalk.bold(`Recently Failed Events (last ${failedSinceHours}h)`), {
          padding: 1,
          borderColor: 'red',
          borderStyle: 'round',
        }),
      );
      console.log();

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
        console.log(chalk.green(`No failed events in the last ${failedSinceHours}h`));
      } else {
        // Show compact table first.
        const failedTable = new Table({
          head: [
            chalk.cyan('Pointer'),
            chalk.cyan('Event'),
            chalk.cyan('Failed Since'),
            chalk.cyan('Error Preview'),
          ],
          colWidths: [25, 30, 25, 60],
          wordWrap: true,
          style: { head: [] },
        });

        for (const row of failedResult.rows) {
          failedTable.push([
            row.pointer,
            row.eventName,
            formatDate(row.updatedAt),
            row.errorPreview,
          ]);
        }

        console.log(failedTable.toString());
        console.log();

        // Show detailed list with full error messages.
        console.log(chalk.bold('Failed Events Details:'));
        console.log();
        for (const event of failedResult.rows) {
          console.log(`${chalk.red('●')} ${chalk.bold(event.pointer)} - ${event.eventName}`);
          console.log(`  Contract: ${event.contractAddress}`);
          console.log(`  Failed since: ${formatDate(event.updatedAt)}`);
          console.log(`  Error: ${event.fullError}`);
          console.log();
        }
      }
      console.log();
    }

    // 3. Processing Rate.
    console.log(
      boxen(chalk.bold('Processing Rate'), {
        padding: 1,
        borderColor: 'green',
        borderStyle: 'round',
      }),
    );
    console.log();

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
      const rateTable = new Table({
        head: [chalk.cyan('Time Window'), chalk.cyan('Events'), chalk.cyan('Rate (events/min)')],
        style: { head: [] },
      });

      rateTable.push(
        ['Last hour', formatNumber(rate.lastHour), (rate.lastHour / 60).toFixed(1)],
        ['Last 15 min', formatNumber(rate.last15Min), (rate.last15Min / 15).toFixed(1)],
        ['Last 5 min', formatNumber(rate.last5Min), (rate.last5Min / 5).toFixed(1)],
      );

      console.log(rateTable.toString());

      if (rate.last5Min < 5 && pendingCount > 0) {
        console.log();
        console.log(chalk.yellow('⚠️  Warning: Low processing rate with pending events'));
      }
    }
    console.log();

    // 4. Pending NFT Transfers.
    console.log(
      boxen(chalk.bold('Pending NFT Transfers'), {
        padding: 1,
        borderColor: 'magenta',
        borderStyle: 'round',
      }),
    );
    console.log();

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
      console.log(`Pending transfers: ${chalk.bold(formatNumber(pendingNft.count))}`);
      if (pendingNft.count > 0 && pendingNft.oldestBlockNumber !== null) {
        console.log(`Oldest pending: block ${pendingNft.oldestBlockNumber}`);

        const blocksBehind = cursor.fetchedToBlock - pendingNft.oldestBlockNumber;
        console.log(`Age: ${blocksBehind} blocks behind cursor`);

        if (blocksBehind > 1000) {
          console.log();
          console.log(
            chalk.yellow(
              '⚠️  Warning: Old pending transfers detected (may indicate missing metadata)',
            ),
          );
        }
      }
    }
    console.log();

    // 5. Database Statistics.
    console.log(
      boxen(chalk.bold('Database Statistics'), {
        padding: 1,
        borderColor: 'blue',
        borderStyle: 'round',
      }),
    );
    console.log();

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
      const dbStatsTable = new Table({
        head: [chalk.cyan('Metric'), chalk.cyan('Value')],
        style: { head: [] },
      });

      dbStatsTable.push(
        ['Events table size', stats.eventsTableSize],
        ['Total events', formatNumber(stats.totalEvents)],
        ['Block hashes cached', formatNumber(stats.blockHashesCached)],
      );

      console.log(dbStatsTable.toString());
    }
    console.log();

    // 6. Platform Stats.
    console.log(
      boxen(chalk.bold('Platform Stats'), {
        padding: 1,
        borderColor: 'cyan',
        borderStyle: 'round',
      }),
    );
    console.log();

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
      const platformTable = new Table({
        head: [chalk.cyan('Metric'), chalk.cyan('Count')],
        style: { head: [] },
      });

      platformTable.push(
        ['Claimed projects', chalk.green(formatNumber(platformStats.claimedProjects))],
        ['Drip lists', chalk.green(formatNumber(platformStats.dripLists))],
        ['Total splits', chalk.green(formatNumber(platformStats.totalSplits))],
      );

      console.log(platformTable.toString());
    }
    console.log();

    // Summary.
    console.log(
      boxen(chalk.bold('Health Summary'), {
        padding: 1,
        borderColor: 'yellow',
        borderStyle: 'round',
      }),
    );
    console.log();

    const stalledCursor = staleMinutes > 5;
    const lowRate = rate && rate.last5Min < 5;

    if (failedCount === 0 && !stalledCursor && !lowRate) {
      console.log(chalk.green.bold('✓ Indexer is healthy'));
    } else if (failedCount > 0 || stalledCursor) {
      console.log(chalk.red.bold('✗ Issues detected - investigation needed'));
      console.log();
      if (failedCount > 0) {
        console.log(`  ${chalk.red('•')} ${failedCount} failed events`);
      }
      if (stalledCursor) {
        console.log(`  ${chalk.red('•')} Stalled cursor (not updated recently)`);
      }
    } else {
      console.log(chalk.yellow.bold('⚠ Minor issues detected - monitor closely'));
    }
    console.log();
  } catch (error) {
    console.log();
    console.log(
      boxen(chalk.bold.red('✗ Status check failed!'), {
        padding: 1,
        borderColor: 'red',
        borderStyle: 'round',
      }),
    );
    console.log();
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// CLI setup.
const program = new Command();

program
  .name('db:status')
  .description('Check database and indexer health status')
  .requiredOption('--db-url <url>', 'Database connection URL')
  .requiredOption('--schema <name>', 'Database schema name')
  .requiredOption('--network <name>', 'Network name (e.g., optimism, mainnet)')
  .option('--hours <n>', 'Failed events window in hours', '24')
  .action(checkStatus);

program.parse();
