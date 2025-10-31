import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';
import { Pool } from 'pg';

import { loadChainConfig } from '../src/chains/loadChainConfig.js';
import { validateSchemaName } from '../src/utils/sqlValidation.js';

import { configureScriptLogger } from './shared/configure-logger.js';
import { formatNumber } from './shared/formatting.js';

// Configure logger for debug output.
configureScriptLogger();

interface InfoOptions {
  dbUrl: string;
  schema: string;
  network: string;
}

type DripListStats = {
  total: number;
  valid: number;
  invalid: number;
  visible: number;
  notVisible: number;
  withVotingRound: number;
};

async function main(options: InfoOptions): Promise<void> {
  const { dbUrl, schema, network } = options;

  // Load chain config from network name.
  const chainConfig = loadChainConfig(network);
  const chainId = String(chainConfig.chainId);
  // Display header.
  console.log(
    boxen(chalk.bold.magenta('📊 DRIP LISTS INFO DASHBOARD 📊'), {
      padding: 1,
      borderColor: 'magenta',
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

    console.log(
      boxen(chalk.bold('Overall Statistics'), {
        padding: 1,
        borderColor: 'blue',
        borderStyle: 'round',
      }),
    );
    console.log();

    const statsResult = await pool.query<DripListStats>(
      `
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE is_valid = true)::int as valid,
        COUNT(*) FILTER (WHERE is_valid = false)::int as invalid,
        COUNT(*) FILTER (WHERE is_visible = true)::int as visible,
        COUNT(*) FILTER (WHERE is_visible = false)::int as "notVisible",
        COUNT(*) FILTER (WHERE latest_voting_round_id IS NOT NULL)::int as "withVotingRound"
      FROM ${validatedSchema}.drip_lists
    `,
    );

    const stats = statsResult.rows[0];
    if (!stats || stats.total === 0) {
      console.log(chalk.yellow('No drip lists found'));
      return;
    }

    console.log(`  Total Drip Lists: ${chalk.green.bold(formatNumber(stats.total))}`);
    console.log();
    console.log(`  ${chalk.cyan('Validity:')}`);
    console.log(
      `    Valid: ${chalk.green(formatNumber(stats.valid))} (${((stats.valid / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `    Invalid: ${chalk.red(formatNumber(stats.invalid))} (${((stats.invalid / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log();
    console.log(`  ${chalk.cyan('Visibility:')}`);
    console.log(
      `    Visible: ${chalk.green(formatNumber(stats.visible))} (${((stats.visible / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `    Not Visible: ${chalk.yellow(formatNumber(stats.notVisible))} (${((stats.notVisible / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log();
    console.log(`  ${chalk.cyan('Voting Rounds:')}`);
    console.log(
      `    With Voting Round: ${chalk.green(formatNumber(stats.withVotingRound))} (${((stats.withVotingRound / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log();

    console.log(
      boxen(chalk.bold('Drip Lists with Invalid Splits'), {
        padding: 1,
        borderColor: 'red',
        borderStyle: 'round',
      }),
    );
    console.log();

    const invalidSplitsResult = await pool.query<{
      accountId: string;
      name: string | null;
      receiverCount: number;
    }>(
      `
      SELECT
        dl.account_id as "accountId",
        dl.name,
        COUNT(sr.id)::int as "receiverCount"
      FROM ${validatedSchema}.drip_lists dl
      LEFT JOIN ${validatedSchema}.splits_receivers sr ON sr.sender_account_id = dl.account_id
        AND sr.relationship_type = 'drip_list_receiver'
      WHERE dl.is_valid = false
      GROUP BY dl.account_id
      ORDER BY dl.created_at DESC
    `,
    );

    if (invalidSplitsResult.rows.length === 0) {
      console.log(`  ${chalk.green('✓ No drip lists with invalid splits')}`);
    } else {
      const displayRows = invalidSplitsResult.rows.map((row) => ({
        accountId: row.accountId,
        name: row.name || 'N/A',
        receivers: row.receiverCount,
      }));
      console.table(displayRows);
      console.log(
        `  ${chalk.red(`⚠️  ${invalidSplitsResult.rows.length} drip list(s) with invalid splits`)}`,
      );
    }
    console.log();

    console.log(
      boxen(chalk.bold('Hidden Drip Lists (Not Visible)'), {
        padding: 1,
        borderColor: 'yellow',
        borderStyle: 'round',
      }),
    );
    console.log();

    const hiddenResult = await pool.query<{
      accountId: string;
      name: string | null;
      receiverCount: number;
    }>(
      `
      SELECT
        dl.account_id as "accountId",
        dl.name,
        COUNT(sr.id)::int as "receiverCount"
      FROM ${validatedSchema}.drip_lists dl
      LEFT JOIN ${validatedSchema}.splits_receivers sr ON sr.sender_account_id = dl.account_id
        AND sr.relationship_type = 'drip_list_receiver'
      WHERE dl.is_visible = false
      GROUP BY dl.account_id
      ORDER BY dl.created_at DESC
    `,
    );

    if (hiddenResult.rows.length === 0) {
      console.log(`  ${chalk.green('✓ No hidden drip lists')}`);
    } else {
      const displayRows = hiddenResult.rows.map((row) => ({
        accountId: row.accountId,
        name: row.name || 'N/A',
        receivers: row.receiverCount,
      }));
      console.table(displayRows);
      console.log(`  ${chalk.yellow(`⚠️  ${hiddenResult.rows.length} hidden drip list(s)`)}`);
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

    const validAndVisibleDripLists = stats.valid && stats.visible ? stats.valid : 0;
    const validAndVisiblePercentage = ((validAndVisibleDripLists / stats.total) * 100).toFixed(1);

    const summaryTable = new Table({
      head: [chalk.cyan('Metric'), chalk.cyan('Value')],
      style: { head: [] },
    });

    summaryTable.push(
      ['Total Drip Lists', chalk.bold(formatNumber(stats.total))],
      [
        'Valid & Visible',
        `${chalk.green.bold(formatNumber(validAndVisibleDripLists))} (${validAndVisiblePercentage}%)`,
      ],
    );

    console.log(summaryTable.toString());
    console.log();

    if (stats.invalid > 0 || stats.notVisible > 0) {
      console.log(chalk.yellow('Issues detected:'));
      if (stats.invalid > 0) {
        console.log(`  ${chalk.red(`⚠️  ${stats.invalid} drip list(s) with invalid splits`)}`);
      }
      if (stats.notVisible > 0) {
        console.log(`  ${chalk.yellow(`⚠️  ${stats.notVisible} drip list(s) not visible`)}`);
      }
      console.log();
    } else {
      console.log(chalk.green('✓ All drip lists are valid and visible!'));
      console.log();
    }
  } catch (error) {
    console.log();
    console.log(
      boxen(chalk.bold.red('✗ Drip Lists info query failed!'), {
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
  .name('info:drip-lists')
  .description('Display comprehensive information about drip lists in the database')
  .requiredOption('--db-url <url>', 'Database connection URL')
  .requiredOption('--schema <name>', 'Database schema name')
  .requiredOption('--network <name>', 'Network name (e.g., optimism, mainnet)')
  .action(main);

program.parse();
