import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';
import { Pool } from 'pg';

import { loadChainConfig } from '../src/chains/loadChainConfig.js';
import { validateSchemaName } from '../src/utils/sqlValidation.js';

import { configureScriptLogger } from './shared/configure-logger.js';
import { formatDate } from './shared/formatting.js';

// Configure logger for debug output.
configureScriptLogger();

interface InfoOptions {
  dbUrl: string;
  schema: string;
  network: string;
  accountId: string;
}

interface SplitsReceiver {
  receiverAccountId: string;
  receiverAccountType: string;
  relationshipType: string;
  weight: number;
  blockTimestamp: Date;
  splitsToRepoDriverSubAccount: boolean | null;
}

interface SplitsStats {
  totalReceivers: number;
  totalWeight: number;
  lastUpdated: Date | null;
}

interface ReceiverByType {
  receiverAccountType: string;
  count: number;
  totalWeight: number;
}

interface ReceiverByRelationship {
  relationshipType: string;
  count: number;
  totalWeight: number;
}

function formatWeight(weight: number): string {
  // Weights are typically represented as parts per million (1000000 = 100%).
  const percentage = (weight / 1000000) * 100;
  return `${percentage.toFixed(2)}%`;
}

async function main(options: InfoOptions): Promise<void> {
  const { dbUrl, schema, network, accountId } = options;

  // Load chain config from network name.
  const chainConfig = loadChainConfig(network);
  const chainId = String(chainConfig.chainId);

  // Display header.
  console.log(
    boxen(chalk.bold.green('🔀 SPLITS RECEIVERS INFO DASHBOARD 🔀'), {
      padding: 1,
      borderColor: 'green',
      borderStyle: 'double',
    }),
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

  const connectionTable = new Table({
    colWidths: [25, 80],
    wordWrap: true,
    style: { head: [] },
  });

  connectionTable.push(
    [chalk.cyan('Database URL'), dbUrl.replace(/:[^:@]+@/, ':***@')],
    [chalk.cyan('Schema'), chalk.bold(schema)],
    [chalk.cyan('Network'), chalk.bold(network)],
    [chalk.cyan('Chain ID'), chalk.bold(chainId)],
    [chalk.cyan('Account ID'), chalk.bold(accountId)],
  );

  console.log(connectionTable.toString());
  console.log();

  const pool = new Pool({ connectionString: dbUrl });

  try {
    // Test connection.
    await pool.query('SELECT 1');

    const validatedSchema = validateSchemaName(schema);

    // Validate schema/network compatibility.
    const cursorResult = await pool.query<{ fetched_to_block: string }>(
      `SELECT fetched_to_block FROM ${validatedSchema}._cursor WHERE chain_id = $1`,
      [chainId],
    );

    if (cursorResult.rows.length === 0) {
      console.log(
        boxen(
          chalk.bold.red(
            `❌ No cursor found for chain ID ${chainId} (network: ${network}) in schema ${schema}`,
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

    // 1. Overall Statistics.
    console.log(
      boxen(chalk.bold('Overall Statistics'), {
        padding: 1,
        borderColor: 'blue',
        borderStyle: 'round',
      }),
    );
    console.log();

    const statsResult = await pool.query<SplitsStats>(
      `
      SELECT
        COUNT(*)::int as "totalReceivers",
        COALESCE(SUM(weight), 0)::int as "totalWeight",
        MAX(block_timestamp) as "lastUpdated"
      FROM ${validatedSchema}.splits_receivers
      WHERE sender_account_id = $1
    `,
      [accountId],
    );

    const stats = statsResult.rows[0];
    if (!stats || stats.totalReceivers === 0) {
      console.log(chalk.yellow('  No splits receivers found for this account'));
      return;
    }

    console.log(`  Total Receivers: ${chalk.green.bold(stats.totalReceivers)}`);
    console.log(`  Total Weight: ${chalk.cyan(formatWeight(stats.totalWeight))}`);
    console.log(`  Last Updated: ${formatDate(stats.lastUpdated)}`);
    console.log();

    // 2. Receivers by Type.
    console.log(
      boxen(chalk.bold('Receivers by Type'), {
        padding: 1,
        borderColor: 'cyan',
        borderStyle: 'round',
      }),
    );
    console.log();

    const byTypeResult = await pool.query<ReceiverByType>(
      `
      SELECT
        receiver_account_type as "receiverAccountType",
        COUNT(*)::int as count,
        SUM(weight)::int as "totalWeight"
      FROM ${validatedSchema}.splits_receivers
      WHERE sender_account_id = $1
      GROUP BY receiver_account_type
      ORDER BY "totalWeight" DESC
    `,
      [accountId],
    );

    if (byTypeResult.rows.length === 0) {
      console.log(chalk.dim('  No data'));
    } else {
      const displayRows = byTypeResult.rows.map((row) => ({
        type: row.receiverAccountType,
        count: row.count,
        weight: formatWeight(row.totalWeight),
      }));
      console.table(displayRows);
    }
    console.log();

    // 3. Receivers by Relationship.
    console.log(
      boxen(chalk.bold('Receivers by Relationship'), {
        padding: 1,
        borderColor: 'cyan',
        borderStyle: 'round',
      }),
    );
    console.log();

    const byRelationshipResult = await pool.query<ReceiverByRelationship>(
      `
      SELECT
        relationship_type as "relationshipType",
        COUNT(*)::int as count,
        SUM(weight)::int as "totalWeight"
      FROM ${validatedSchema}.splits_receivers
      WHERE sender_account_id = $1
      GROUP BY relationship_type
      ORDER BY "totalWeight" DESC
    `,
      [accountId],
    );

    if (byRelationshipResult.rows.length === 0) {
      console.log(chalk.dim('  No data'));
    } else {
      const displayRows = byRelationshipResult.rows.map((row) => ({
        relationship: row.relationshipType,
        count: row.count,
        weight: formatWeight(row.totalWeight),
      }));
      console.table(displayRows);
    }
    console.log();

    // 4. Detailed Receivers List.
    console.log(
      boxen(chalk.bold('Detailed Receivers List'), {
        padding: 1,
        borderColor: 'magenta',
        borderStyle: 'round',
      }),
    );
    console.log();

    const receiversResult = await pool.query<SplitsReceiver>(
      `
      SELECT
        receiver_account_id as "receiverAccountId",
        receiver_account_type as "receiverAccountType",
        relationship_type as "relationshipType",
        weight,
        block_timestamp as "blockTimestamp",
        splits_to_repo_driver_sub_account as "splitsToRepoDriverSubAccount"
      FROM ${validatedSchema}.splits_receivers
      WHERE sender_account_id = $1
      ORDER BY weight DESC
    `,
      [accountId],
    );

    if (receiversResult.rows.length === 0) {
      console.log(chalk.dim('  No receivers'));
    } else {
      const displayRows = receiversResult.rows.map((row) => ({
        receiverAccountId: row.receiverAccountId.substring(0, 30) + '...',
        type: row.receiverAccountType,
        relationship: row.relationshipType,
        weight: formatWeight(row.weight),
        repoDriverSub: row.splitsToRepoDriverSubAccount ? '✓' : '✗',
        lastUpdated: formatDate(row.blockTimestamp),
      }));
      console.table(displayRows);
    }
    console.log();

    // 5. Matrix: Type x Relationship.
    console.log(
      boxen(chalk.bold('Matrix: Type × Relationship'), {
        padding: 1,
        borderColor: 'yellow',
        borderStyle: 'round',
      }),
    );
    console.log();

    const matrixResult = await pool.query<{
      receiverAccountType: string;
      relationshipType: string;
      count: number;
      totalWeight: number;
    }>(
      `
      SELECT
        receiver_account_type as "receiverAccountType",
        relationship_type as "relationshipType",
        COUNT(*)::int as count,
        SUM(weight)::int as "totalWeight"
      FROM ${validatedSchema}.splits_receivers
      WHERE sender_account_id = $1
      GROUP BY receiver_account_type, relationship_type
      ORDER BY receiver_account_type, relationship_type
    `,
      [accountId],
    );

    if (matrixResult.rows.length === 0) {
      console.log(chalk.dim('  No data'));
    } else {
      const displayRows = matrixResult.rows.map((row) => ({
        type: row.receiverAccountType,
        relationship: row.relationshipType,
        count: row.count,
        weight: formatWeight(row.totalWeight),
      }));
      console.table(displayRows);
    }
    console.log();

    // 6. Summary.
    console.log(
      boxen(chalk.bold('Summary'), {
        padding: 1,
        borderColor: 'cyan',
        borderStyle: 'round',
      }),
    );
    console.log();

    const summaryTable = new Table({
      head: [chalk.cyan('Metric'), chalk.cyan('Value')],
      style: { head: [] },
    });

    summaryTable.push(
      ['Account ID', chalk.bold(accountId)],
      ['Total Receivers', chalk.bold(stats.totalReceivers)],
      ['Total Weight', chalk.bold(formatWeight(stats.totalWeight))],
    );

    console.log(summaryTable.toString());
    console.log();

    if (stats.totalWeight !== 1000000) {
      const diff = 1000000 - stats.totalWeight;
      const diffPercent = (diff / 1000000) * 100;
      if (diff > 0) {
        console.log(
          chalk.yellow(
            `⚠️  Weight is ${formatWeight(diff)} (${diffPercent.toFixed(2)}%) under 100%`,
          ),
        );
      } else {
        console.log(
          chalk.red(
            `⚠️  Weight is ${formatWeight(-diff)} (${Math.abs(diffPercent).toFixed(2)}%) over 100%`,
          ),
        );
      }
      console.log();
    } else {
      console.log(chalk.green('✓ Weight is exactly 100%'));
      console.log();
    }
  } catch (error) {
    console.log();
    console.log(
      boxen(chalk.bold.red('✗ Splits info query failed!'), {
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
  .name('info:splits')
  .description('Display comprehensive information about splits receivers for a specific account')
  .requiredOption('--db-url <url>', 'Database connection URL')
  .requiredOption('--schema <name>', 'Database schema name')
  .requiredOption('--network <name>', 'Network name (e.g., optimism, mainnet)')
  .requiredOption('--account-id <id>', 'Account ID to inspect splits for')
  .action(main);

program.parse();
