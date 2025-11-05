/**
 * SCRIPT: Rollback
 *
 * Rolls back the indexer state to a specific block by deleting events and block hashes
 * from that point onwards, then resets the cursor for re-indexing from that block.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';
import { Pool, types } from 'pg';
import { createPublicClient, http, type Chain } from 'viem';

import { loadChainConfig } from '../src/chains/loadChainConfig.js';
import { config } from '../src/config.js';
import { RpcClient } from '../src/core/RpcClient.js';
import { ReorgDetector } from '../src/core/ReorgDetector.js';
import { CursorRepository } from '../src/repositories/CursorRepository.js';
import { EventRepository } from '../src/repositories/EventsRepository.js';
import { BlockHashesRepository } from '../src/repositories/BlockHashesRepository.js';
import { validateSchemaName } from '../src/utils/sqlValidation.js';

import { configureScriptLogger } from './shared/configure-logger.js';
import { formatNumber } from './shared/formatting.js';
import { prompt } from './shared/prompt.js';

// Configure logger for debug output.
configureScriptLogger();

interface RollbackOptions {
  dbUrl: string;
  schema: string;
  network: string;
  block: string;
  rpcUrl: string;
}

async function rollback(options: RollbackOptions): Promise<void> {
  const block = BigInt(options.block);

  // Load chain config from network name.
  const chainConfig = loadChainConfig(options.network);
  const chainId = String(chainConfig.chainId);

  // Display header.
  console.log(
    boxen(chalk.bold.red('🔄 ROLLBACK SCRIPT 🔄'), {
      padding: 1,
      borderColor: 'red',
      borderStyle: 'double',
    }),
  );
  console.log();

  // Determine if connection is local or remote.
  const isLocalDb = /(?:localhost|127\.0\.0\.1|::1|\/var\/run\/|\.sock)/i.test(options.dbUrl);
  const connectionType = isLocalDb ? 'LOCAL' : 'REMOTE';
  const connectionColor = isLocalDb ? 'yellow' : 'red';
  const connectionEmoji = isLocalDb ? '🏠' : '🌐';

  console.log(
    boxen(
      chalk.bold[connectionColor](
        `${connectionEmoji} DATABASE CONNECTION: ${connectionType} ${connectionEmoji}`,
      ),
      {
        padding: 1,
        borderColor: connectionColor,
        borderStyle: 'bold',
      },
    ),
  );
  console.log();

  // Display preview of what will be affected.
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
    [chalk.cyan('RPC URL'), options.rpcUrl],
    [chalk.cyan('Rollback to Block'), chalk.bold.yellow(block.toString())],
  );

  console.log(previewTable.toString());
  console.log();

  // Configure pg types.
  types.setTypeParser(types.builtins.INT8, (val: string) => BigInt(val));

  const pool = new Pool({
    connectionString: options.dbUrl,
  });

  try {
    // Test connection and fetch table info.
    await pool.query('SELECT 1');

    const schema = validateSchemaName(options.schema);

    // Get table counts before rollback.
    const tablesTable = new Table({
      head: [chalk.cyan('Table'), chalk.cyan('Total Rows'), chalk.cyan(`Rows >= Block ${block}`)],
      style: { head: [] },
    });

    const eventsCountResult = await pool.query<{ total: string; affected: string }>(
      `SELECT
        COUNT(*)::text as total,
        COUNT(*) FILTER (WHERE block_number >= $2)::text as affected
       FROM ${schema}._events
       WHERE chain_id = $1`,
      [chainId, block.toString()],
    );
    const eventsTotal = BigInt(eventsCountResult.rows[0]?.total || '0');
    const eventsAffected = BigInt(eventsCountResult.rows[0]?.affected || '0');

    const hashesCountResult = await pool.query<{ total: string; affected: string }>(
      `SELECT
        COUNT(*)::text as total,
        COUNT(*) FILTER (WHERE block_number >= $2)::text as affected
       FROM ${schema}._block_hashes
       WHERE chain_id = $1`,
      [chainId, block.toString()],
    );
    const hashesTotal = BigInt(hashesCountResult.rows[0]?.total || '0');
    const hashesAffected = BigInt(hashesCountResult.rows[0]?.affected || '0');

    const cursorResult = await pool.query(
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

    const currentCursor = cursorResult.rows[0]
      ? BigInt(cursorResult.rows[0].fetched_to_block)
      : null;

    tablesTable.push(
      [
        '_events',
        formatNumber(eventsTotal),
        eventsAffected > 0n ? chalk.red(formatNumber(eventsAffected)) : chalk.green('0'),
      ],
      [
        '_block_hashes',
        formatNumber(hashesTotal),
        hashesAffected > 0n ? chalk.red(formatNumber(hashesAffected)) : chalk.green('0'),
      ],
      [
        '_cursor',
        '1',
        currentCursor !== null
          ? chalk.yellow(`${currentCursor} → ${block - 1n}`)
          : chalk.dim('N/A'),
      ],
    );

    console.log(
      boxen(chalk.bold('Tables to be Modified'), {
        padding: 1,
        borderColor: 'yellow',
        borderStyle: 'round',
      }),
    );
    console.log();
    console.log(tablesTable.toString());
    console.log();

    // Show warnings.
    console.log(
      boxen(chalk.bold.yellow('⚠️  WARNING: This operation is DESTRUCTIVE and IRREVERSIBLE! ⚠️'), {
        padding: 1,
        borderColor: 'yellow',
        borderStyle: 'bold',
      }),
    );
    console.log();

    console.log(chalk.bold('This script will:'));
    console.log(`  ${chalk.red('1.')} DELETE all events from block ${block} onwards`);
    console.log(`  ${chalk.red('2.')} DELETE all block hashes from block ${block} onwards`);
    console.log(`  ${chalk.red('3.')} RESET cursor to block ${block - 1n}`);
    console.log();

    console.log(chalk.bold.yellow('BEFORE PROCEEDING:'));
    console.log(`  ${chalk.yellow('1.')} Ensure the indexer is STOPPED`);
    console.log(
      `  ${chalk.yellow('2.')} Ensure no other processes are accessing the database (for this schema/network)`,
    );
    console.log(`  ${chalk.yellow('3.')} Verify the rollback block number is correct`);
    console.log();

    // Warnings for edge cases.
    if (currentCursor !== null && block > currentCursor) {
      console.log(
        chalk.yellow(
          `⚠️  Warning: Rollback block (${block}) is ahead of current cursor (${currentCursor})`,
        ),
      );
      console.log(chalk.yellow('This is unusual but may be valid if cursor was manually reset.'));
      console.log();
    }

    if (eventsAffected === 0n && hashesAffected === 0n) {
      console.log(
        chalk.yellow('⚠️  Warning: No data found to delete. Rollback may be unnecessary.'),
      );
      console.log();
    }

    // Confirmations.
    const confirm1 = await prompt(chalk.bold('Have you STOPPED the indexer? (yes/no): '));
    if (confirm1.toLowerCase() !== 'yes') {
      console.log(chalk.red('Aborting. Please stop the indexer first.'));
      process.exit(1);
    }

    const confirm2 = await prompt(
      chalk.bold(
        `Are you ABSOLUTELY SURE you want to delete data from block ${block} onwards? Type 'DELETE' to confirm: `,
      ),
    );
    if (confirm2 !== 'DELETE') {
      console.log(chalk.red('Aborting. Confirmation not received.'));
      process.exit(1);
    }

    console.log();
    console.log(chalk.blue('Starting rollback...'));
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

    // Execute handleReorg.
    await reorgDetector.handleReorg(block);

    console.log();
    console.log(
      boxen(chalk.bold.green('✓ Rollback completed successfully!'), {
        padding: 1,
        borderColor: 'green',
        borderStyle: 'round',
      }),
    );
    console.log();
    console.log(chalk.bold('Next steps:'));
    console.log('  1. Verify cursor position in database');
    console.log('  2. Run orphan inspection script to check for orphaned domain entities:');
    console.log(
      `     ${chalk.blue(`npm run inspect:orphans -- --db-url "${options.dbUrl}" --schema ${options.schema} --network ${options.network} --block ${block} --rpc-url "${options.rpcUrl}"`)}`,
    );
    console.log('  3. Monitor indexing progress:');
    console.log(
      `     ${chalk.blue(`tsx scripts/monitor-progress.ts --db-url "${options.dbUrl}" --schema ${options.schema} --rpc-url "${options.rpcUrl}"`)}`,
    );
    console.log('  4. Restart the indexer to resume from the rolled-back cursor position');
    console.log();
  } catch (error) {
    console.log();
    console.log(
      boxen(chalk.bold.red('✗ Rollback failed!'), {
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
  .name('rollback')
  .description('Roll back the indexer state to a specific block')
  .requiredOption('--db-url <url>', 'Database connection URL')
  .requiredOption('--schema <name>', 'Database schema name')
  .requiredOption('--network <name>', 'Network name (e.g., optimism, mainnet)')
  .requiredOption('--block <number>', 'Block number to roll back to')
  .requiredOption('--rpc-url <url>', 'RPC endpoint URL')
  .action(rollback);

program.parse();
