import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';
import { Pool, types } from 'pg';
import { createPublicClient, http, type Chain } from 'viem';

import { loadChainConfig } from '../src/chains/loadChainConfig.js';
import { validateSchemaName } from '../src/utils/sqlValidation.js';
import { RpcClient } from '../src/core/RpcClient.js';
import { ReorgDetector } from '../src/core/ReorgDetector.js';
import { CursorRepository } from '../src/repositories/CursorRepository.js';
import { EventRepository } from '../src/repositories/EventsRepository.js';
import { BlockHashesRepository } from '../src/repositories/BlockHashesRepository.js';
import { config } from '../src/config.js';

import { configureScriptLogger } from './shared/configure-logger.js';
import { formatNumber } from './shared/formatting.js';

// Configure logger for debug output.
configureScriptLogger();

interface InspectOptions {
  dbUrl: string;
  schema: string;
  network: string;
  block: string;
  rpcUrl: string;
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

    // Create RPC client.
    const client = createPublicClient({
      chain: { id: parseInt(chainId, 10) } as Chain,
      transport: http(options.rpcUrl, {
        timeout: 30000,
      }),
    });

    const rpc = new RpcClient(client, {
      chainId: parseInt(chainId, 10),
      concurrency: 1,
    });

    // Initialize repositories.
    const cursorRepo = new CursorRepository(schema, chainId);
    const eventsRepo = new EventRepository(schema, chainId);
    const blockHashesRepo = new BlockHashesRepository(pool, schema);

    // Create ReorgDetector.
    const reorgDetector = new ReorgDetector(
      pool,
      schema,
      chainId,
      rpc,
      BigInt(config.chain.startBlock || 0),
      config.chain.confirmations,
      false,
      cursorRepo,
      eventsRepo,
      blockHashesRepo,
    );

    // Discover domain tables.
    const domainTables = await reorgDetector.discoverDomainTables();
    console.log(chalk.green(`✓ Discovered ${domainTables.length} domain tables from schema`));
    if (domainTables.length > 0) {
      const tableList = domainTables.map((table) => table.name).join(', ');
      console.log(chalk.blue(`Tables inspected: ${tableList}`));
    } else {
      console.log(chalk.yellow('No domain tables discovered for inspection'));
    }
    console.log();

    // Detect orphans.
    console.log(chalk.blue('Scanning domain tables for orphaned records...'));
    console.log();

    const orphans = await reorgDetector.detectOrphans(block);

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

    // Group orphans by table.
    const orphansByTable = new Map<string, Array<{ primaryKey: string; lastEventBlock: string }>>();
    for (const orphan of orphans) {
      if (!orphansByTable.has(orphan.tableName)) {
        orphansByTable.set(orphan.tableName, []);
      }
      orphansByTable.get(orphan.tableName)!.push({
        primaryKey: orphan.primaryKey,
        lastEventBlock: orphan.lastEventBlock,
      });
    }

    // Show all tables, even those with no orphans.
    for (const table of domainTables) {
      const tableOrphans = orphansByTable.get(table.name) || [];
      const orphanCount = tableOrphans.length;

      if (orphanCount > 0) {
        console.log(
          `${chalk.yellow(table.name)}: ${chalk.red(`${orphanCount} potential orphan(s)`)}`,
        );

        if (orphanCount <= 20) {
          // Show details for small sets.
          for (const record of tableOrphans) {
            console.log(`  - ${record.primaryKey} (last_event_block: ${record.lastEventBlock})`);
          }
        } else {
          // Just show a sample for large sets.
          console.log(`  Showing first 5 of ${orphanCount}:`);
          for (let i = 0; i < Math.min(5, tableOrphans.length); i++) {
            const record = tableOrphans[i]!;
            console.log(`  - ${record.primaryKey} (last_event_block: ${record.lastEventBlock})`);
          }
          console.log(`  ... and ${orphanCount - 5} more`);
        }
        console.log();
      } else {
        console.log(`${chalk.green(table.name)}: No orphans detected`);
      }
    }

    const totalOrphans = orphans.length;
    const tablesWithOrphans = Array.from(orphansByTable.keys());

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
  .requiredOption('--rpc-url <url>', 'RPC endpoint URL')
  .action(inspect);

program.parse();
