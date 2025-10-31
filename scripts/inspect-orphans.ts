import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';
import { Pool, types } from 'pg';

import { loadChainConfig } from '../src/chains/loadChainConfig.js';
import { validateSchemaName } from '../src/utils/sqlValidation.js';

import { configureScriptLogger } from './shared/configure-logger.js';
import { formatNumber } from './shared/formatting.js';

// Configure logger for debug output.
configureScriptLogger();

interface InspectOptions {
  dbUrl: string;
  schema: string;
  network: string;
  block: string;
}

interface OrphanResult {
  tableName: string;
  orphanedRecords: OrphanRecord[];
}

interface OrphanRecord {
  primaryKey: string;
  blockNumber: bigint | undefined;
  createdAt: Date;
}

/**
 * Discovers domain entity tables that can have orphaned records after a reorg.
 * Domain tables are all tables created by processing events that:
 * - Have a 'created_at' column (event-driven entities)
 * - Are not system tables (prefixed with _) except _pending_nft_transfers
 * - Are not event log tables (suffixed with _events)
 * - Have event pointer columns (last_event_block, last_event_tx_index, last_event_log_index)
 *
 * Auto-discovers table metadata from the database schema.
 */
async function discoverDomainTables(
  pool: Pool,
  schema: string,
): Promise<Array<{ name: string; pkColumn: string; hasBlockNumber: boolean }>> {
  const result = await pool.query<{
    table_name: string;
    pk_column: string;
    has_block_number: boolean;
  }>(
    `
    SELECT DISTINCT
      t.table_name,
      (
        SELECT c.column_name
        FROM information_schema.table_constraints tc
        INNER JOIN information_schema.constraint_column_usage c
          ON tc.constraint_name = c.constraint_name
          AND tc.table_schema = c.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = t.table_schema
          AND tc.table_name = t.table_name
        LIMIT 1
      ) as pk_column,
      EXISTS(
        SELECT 1
        FROM information_schema.columns bc
        WHERE bc.table_schema = t.table_schema
          AND bc.table_name = t.table_name
          AND bc.column_name = 'block_number'
      ) as has_block_number
    FROM information_schema.tables t
    INNER JOIN information_schema.columns c
      ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
      AND c.column_name = 'created_at'
    INNER JOIN information_schema.columns ep
      ON t.table_schema = ep.table_schema
      AND t.table_name = ep.table_name
      AND ep.column_name = 'last_event_block'
    WHERE t.table_schema = $1
      AND t.table_type = 'BASE TABLE'
      AND (
        t.table_name NOT LIKE '\\_%'
        OR t.table_name = '_pending_nft_transfers'
      )
      AND NOT (
        t.table_name LIKE '%\\_events'
        AND t.table_name != '_pending_nft_transfers'
      )
    ORDER BY t.table_name
    `,
    [schema],
  );

  return result.rows.map((row) => ({
    name: row.table_name,
    pkColumn: row.pk_column,
    hasBlockNumber: row.has_block_number,
  }));
}

async function inspectOrphans(
  pool: Pool,
  schema: string,
  chainId: string,
  block: bigint,
  domainTables: Array<{ name: string; pkColumn: string; hasBlockNumber: boolean }>,
): Promise<OrphanResult[]> {
  const results: OrphanResult[] = [];

  console.log(chalk.blue('Scanning domain tables for orphaned records...'));
  console.log();

  for (const table of domainTables) {
    console.log(`  Checking ${chalk.yellow(table.name)}...`);

    // Check for records where the event pointer doesn't resolve to an existing event.
    // Strategy: LEFT JOIN domain table to _events using event pointer columns.
    // Records with NULL e.id are orphans (event pointer points to non-existent event).
    // When --block is provided, only check records at/after that block (excludes legacy NULL pointers).
    const query = `
      SELECT
        t.${table.pkColumn} as primary_key,
        ${table.hasBlockNumber ? 't.block_number,' : 'NULL as block_number,'}
        t.created_at,
        t.last_event_block,
        t.last_event_tx_index,
        t.last_event_log_index
      FROM ${schema}.${table.name} t
      LEFT JOIN ${schema}._events e
        ON e.chain_id = $1
        AND e.block_number = t.last_event_block
        AND e.tx_index = t.last_event_tx_index
        AND e.log_index = t.last_event_log_index
      WHERE
        -- Rows with event pointers that don't resolve to existing events.
        t.last_event_block IS NOT NULL
        AND e.id IS NULL
        ${block !== undefined ? `AND t.last_event_block >= $2` : ''}
      ORDER BY t.created_at DESC
      LIMIT 1000
    `;
    const params = block !== undefined ? [chainId, block.toString()] : [chainId];

    const result = await pool.query<{
      primary_key: string;
      block_number: string | null;
      created_at: Date;
      last_event_block: string | null;
      last_event_tx_index: number | null;
      last_event_log_index: number | null;
    }>(query, params);

    const orphanedRecords: OrphanRecord[] = result.rows.map((row) => ({
      primaryKey: row.primary_key,
      blockNumber: row.block_number ? BigInt(row.block_number) : undefined,
      createdAt: row.created_at,
    }));

    results.push({
      tableName: table.name,
      orphanedRecords,
    });
  }

  return results;
}

async function inspect(options: InspectOptions): Promise<void> {
  const block = BigInt(options.block);

  // Load chain config from network name.
  const chainConfig = loadChainConfig(options.network);
  const chainId = String(chainConfig.chainId);

  // Display header.
  console.log(
    boxen(chalk.bold.blue('🔍 ORPHAN INSPECTION SCRIPT 🔍'), {
      padding: 1,
      borderColor: 'blue',
      borderStyle: 'double',
    }),
  );
  console.log();

  console.log(chalk.blue('This script identifies orphaned domain entities.'));
  console.log(
    chalk.blue('Orphaned records are entities without corresponding events (reorgs, bugs, etc).'),
  );
  console.log();

  // Display connection info.
  console.log(
    boxen(chalk.bold('Database Connection & Target Information'), {
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
    [chalk.cyan('Inspecting from Block'), chalk.bold.yellow(block.toString())],
  );

  console.log(previewTable.toString());
  console.log();

  // Configure pg types.
  types.setTypeParser(types.builtins.INT8, (val: string) => BigInt(val));

  const pool = new Pool({
    connectionString: options.dbUrl,
  });

  try {
    // Test connection.
    await pool.query('SELECT 1');

    const schema = validateSchemaName(options.schema);

    // Check if cursor exists.
    const cursorResult = await pool.query<{ fetched_to_block: string }>(
      `SELECT fetched_to_block FROM ${schema}._cursor WHERE chain_id = $1`,
      [chainId],
    );

    // Validate schema/network compatibility.
    if (cursorResult.rows.length === 0) {
      console.log(
        boxen(
          chalk.bold.red(
            `❌ No cursor found for chain ID ${chainId} (network: ${options.network}) in schema ${options.schema}`,
          ),
          {
            padding: 1,
            borderColor: 'red',
            borderStyle: 'round',
          },
        ),
      );
      console.log();
      console.log(chalk.yellow('Possible issues:'));
      console.log(`  1. Wrong network name (check your network configuration)`);
      console.log(`  2. Wrong schema name`);
      console.log(`  3. Schema not initialized yet`);
      console.log(`  4. Network/schema mismatch (one schema per chain)`);
      process.exit(1);
    }

    const currentCursor = BigInt(cursorResult.rows[0]!.fetched_to_block);
    console.log(chalk.blue(`Current cursor position: ${currentCursor.toString()}`));
    console.log();

    // Discover domain tables from database schema.
    const domainTables = await discoverDomainTables(pool, schema);
    console.log(chalk.green(`✓ Discovered ${domainTables.length} domain tables from schema`));
    if (domainTables.length > 0) {
      const tableList = domainTables.map((table) => table.name).join(', ');
      console.log(chalk.blue(`Tables inspected: ${tableList}`));
    } else {
      console.log(chalk.yellow('No domain tables discovered for inspection'));
    }
    console.log();

    // Inspect orphans.
    const results = await inspectOrphans(pool, schema, chainId, block, domainTables);

    // Display results.
    console.log();
    console.log(
      boxen(chalk.bold('Inspection Results'), {
        padding: 1,
        borderColor: 'magenta',
        borderStyle: 'round',
      }),
    );
    console.log();

    let totalOrphans = 0;
    const tablesWithOrphans: string[] = [];

    for (const result of results) {
      const orphanCount = result.orphanedRecords.length;
      totalOrphans += orphanCount;

      if (orphanCount > 0) {
        tablesWithOrphans.push(result.tableName);
        console.log(
          `${chalk.yellow(result.tableName)}: ${chalk.red(`${orphanCount} potential orphan(s)`)}`,
        );

        if (orphanCount <= 20) {
          // Show details for small sets.
          for (const record of result.orphanedRecords) {
            const blockInfo = record.blockNumber
              ? ` (block: ${record.blockNumber.toString()})`
              : '';
            console.log(
              `  - ${record.primaryKey} ${blockInfo} (created: ${record.createdAt.toISOString()})`,
            );
          }
        } else {
          // Just show a sample for large sets.
          console.log(`  Showing first 5 of ${orphanCount}:`);
          for (let i = 0; i < Math.min(5, result.orphanedRecords.length); i++) {
            const record = result.orphanedRecords[i]!;
            const blockInfo = record.blockNumber
              ? ` (block: ${record.blockNumber.toString()})`
              : '';
            console.log(
              `  - ${record.primaryKey} ${blockInfo} (created: ${record.createdAt.toISOString()})`,
            );
          }
          console.log(`  ... and ${orphanCount - 5} more`);
        }
        console.log();
      } else {
        console.log(`${chalk.green(result.tableName)}: No orphans detected`);
      }
    }

    console.log();
    console.log(
      boxen(chalk.bold('Summary'), {
        padding: 1,
        borderColor: 'cyan',
        borderStyle: 'round',
      }),
    );
    console.log();

    if (totalOrphans === 0) {
      console.log(chalk.green('✓ No orphaned records detected!'));
      console.log();
      console.log('The database appears consistent with the current chain state.');
    } else {
      const summaryTable = new Table({
        head: [chalk.cyan('Metric'), chalk.cyan('Value')],
        style: { head: [] },
      });

      summaryTable.push(
        ['Total Orphaned Records', chalk.red(formatNumber(totalOrphans))],
        ['Tables Affected', chalk.yellow(tablesWithOrphans.length.toString())],
      );

      console.log(summaryTable.toString());
      console.log();

      console.log(chalk.yellow('Affected tables:'));
      for (const table of tablesWithOrphans) {
        console.log(`  - ${table}`);
      }
      console.log();
      console.log(chalk.bold.yellow('IMPORTANT:'));
      console.log('  This script uses heuristics and may report false positives.');
      console.log('  Orphaned records should be manually reviewed before deletion.');
      console.log();
      console.log(chalk.blue('Recommended Actions:'));
      console.log('  1. Review the listed records and verify they are actually orphaned');
      console.log(
        '  2. Check if corresponding events exist in _events table that created these records',
      );
      console.log('  3. If confirmed orphaned, consider manual cleanup or re-running recovery');
      console.log(
        '  4. For future reorgs, ensure AUTO_HANDLE_REORGS is enabled or manual recovery is run promptly',
      );
    }

    console.log();
  } catch (error) {
    console.log();
    console.log(
      boxen(chalk.bold.red('✗ Orphan inspection failed!'), {
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
  .name('inspect:orphans')
  .description('Inspect database for orphaned domain entities after a rollback')
  .requiredOption('--db-url <url>', 'Database connection URL')
  .requiredOption('--schema <name>', 'Database schema name')
  .requiredOption('--network <name>', 'Network name (e.g., optimism, mainnet)')
  .requiredOption('--block <number>', 'Block number to inspect from')
  .action(inspect);

program.parse();
