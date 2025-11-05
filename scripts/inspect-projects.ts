/**
 * SCRIPT: Inspect Projects
 *
 * Displays comprehensive information about projects including verification status,
 * splits validity, visibility, forge distribution, and identifies invalid or hidden projects.
 */

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

interface ProjectStats {
  total: number;
  claimed: number;
  unclaimed: number;
  pendingMetadata: number;
  validSplits: number;
  invalidSplits: number;
  visible: number;
  notVisible: number;
  github: number;
  gitlab: number;
  noForge: number;
}

interface ProjectCombination {
  verificationStatus: string;
  areSplitsValid: boolean;
  isVisible: boolean;
  count: number;
}

async function main(options: InfoOptions): Promise<void> {
  const { dbUrl, schema, network } = options;

  // Load chain config from network name.
  const chainConfig = loadChainConfig(network);
  const chainId = String(chainConfig.chainId);
  // Display header.
  console.log(
    boxen(chalk.bold.blue('📊 PROJECTS INFO DASHBOARD 📊'), {
      padding: 1,
      borderColor: 'blue',
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

    // 1. Overall Statistics.
    console.log(
      boxen(chalk.bold('Overall Statistics'), {
        padding: 1,
        borderColor: 'blue',
        borderStyle: 'round',
      }),
    );
    console.log();

    const statsResult = await pool.query<ProjectStats>(
      `
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE verification_status = 'claimed')::int as claimed,
        COUNT(*) FILTER (WHERE verification_status = 'unclaimed')::int as unclaimed,
        COUNT(*) FILTER (WHERE verification_status = 'pending_metadata')::int as "pendingMetadata",
        COUNT(*) FILTER (WHERE is_valid = true)::int as "validSplits",
        COUNT(*) FILTER (WHERE is_valid = false)::int as "invalidSplits",
        COUNT(*) FILTER (WHERE is_visible = true)::int as visible,
        COUNT(*) FILTER (WHERE is_visible = false)::int as "notVisible",
        COUNT(*) FILTER (WHERE forge = 'github')::int as github,
        COUNT(*) FILTER (WHERE forge = 'gitlab')::int as gitlab,
        COUNT(*) FILTER (WHERE forge IS NULL)::int as "noForge"
      FROM ${validatedSchema}.projects
    `,
    );

    const stats = statsResult.rows[0];
    if (!stats || stats.total === 0) {
      console.log(chalk.yellow('No projects found'));
      return;
    }

    console.log(`  Total Projects: ${chalk.green.bold(formatNumber(stats.total))}`);
    console.log();
    console.log(`  ${chalk.cyan('Verification Status:')}`);
    console.log(
      `    Claimed: ${chalk.green(formatNumber(stats.claimed))} (${((stats.claimed / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `    Unclaimed: ${chalk.yellow(formatNumber(stats.unclaimed))} (${((stats.unclaimed / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `    Pending Metadata: ${chalk.magenta(formatNumber(stats.pendingMetadata))} (${((stats.pendingMetadata / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log();
    console.log(`  ${chalk.cyan('Splits Validity:')}`);
    console.log(
      `    Valid: ${chalk.green(formatNumber(stats.validSplits))} (${((stats.validSplits / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `    Invalid: ${chalk.red(formatNumber(stats.invalidSplits))} (${((stats.invalidSplits / stats.total) * 100).toFixed(1)}%)`,
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
    console.log(`  ${chalk.cyan('Forge Distribution:')}`);
    console.log(
      `    GitHub: ${chalk.green(formatNumber(stats.github))} (${((stats.github / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `    GitLab: ${chalk.blue(formatNumber(stats.gitlab))} (${((stats.gitlab / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `    None: ${chalk.yellow(formatNumber(stats.noForge))} (${((stats.noForge / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log();

    // 2. Combinations Matrix.
    console.log(
      boxen(chalk.bold('Status Combinations'), {
        padding: 1,
        borderColor: 'cyan',
        borderStyle: 'round',
      }),
    );
    console.log();

    const combinationsResult = await pool.query<ProjectCombination>(
      `
      SELECT
        verification_status as "verificationStatus",
        is_valid as "areSplitsValid",
        is_visible as "isVisible",
        COUNT(*)::int as count
      FROM ${validatedSchema}.projects
      GROUP BY verification_status, is_valid, is_visible
      ORDER BY
        CASE verification_status
          WHEN 'claimed' THEN 1
          WHEN 'unclaimed' THEN 2
          WHEN 'pending_metadata' THEN 3
        END,
        is_valid DESC,
        is_visible DESC
    `,
    );

    console.table(combinationsResult.rows);
    console.log();

    // 3. Claimed Projects Breakdown (claimed_at IS NOT NULL).
    console.log(
      boxen(chalk.bold('Claimed Projects Breakdown (by claimed_at)'), {
        padding: 1,
        borderColor: 'green',
        borderStyle: 'round',
      }),
    );
    console.log();

    const claimedStatsResult = await pool.query<{
      category: string;
      count: number;
    }>(
      `
      SELECT
        CASE
          WHEN verification_status = 'pending_metadata' THEN 'Pending Metadata'
          WHEN verification_status = 'claimed' AND is_valid = false THEN 'Claimed but Invalid Splits'
          WHEN verification_status = 'claimed' AND is_valid = true THEN 'Claimed and Valid'
          WHEN verification_status = 'unclaimed' AND is_valid = false THEN 'Unclaimed but Invalid'
          WHEN verification_status = 'unclaimed' AND is_valid = true THEN 'Unclaimed but Valid'
          ELSE 'Other'
        END as category,
        COUNT(*)::int as count
      FROM ${validatedSchema}.projects
      WHERE claimed_at IS NOT NULL
      GROUP BY
        CASE
          WHEN verification_status = 'pending_metadata' THEN 'Pending Metadata'
          WHEN verification_status = 'claimed' AND is_valid = false THEN 'Claimed but Invalid Splits'
          WHEN verification_status = 'claimed' AND is_valid = true THEN 'Claimed and Valid'
          WHEN verification_status = 'unclaimed' AND is_valid = false THEN 'Unclaimed but Invalid'
          WHEN verification_status = 'unclaimed' AND is_valid = true THEN 'Unclaimed but Valid'
          ELSE 'Other'
        END
      ORDER BY
        CASE
          WHEN CASE
            WHEN verification_status = 'pending_metadata' THEN 'Pending Metadata'
            WHEN verification_status = 'claimed' AND is_valid = false THEN 'Claimed but Invalid Splits'
            WHEN verification_status = 'claimed' AND is_valid = true THEN 'Claimed and Valid'
            WHEN verification_status = 'unclaimed' AND is_valid = false THEN 'Unclaimed but Invalid'
            WHEN verification_status = 'unclaimed' AND is_valid = true THEN 'Unclaimed but Valid'
            ELSE 'Other'
          END = 'Claimed and Valid' THEN 1
          WHEN CASE
            WHEN verification_status = 'pending_metadata' THEN 'Pending Metadata'
            WHEN verification_status = 'claimed' AND is_valid = false THEN 'Claimed but Invalid Splits'
            WHEN verification_status = 'claimed' AND is_valid = true THEN 'Claimed and Valid'
            WHEN verification_status = 'unclaimed' AND is_valid = false THEN 'Unclaimed but Invalid'
            WHEN verification_status = 'unclaimed' AND is_valid = true THEN 'Unclaimed but Valid'
            ELSE 'Other'
          END = 'Claimed but Invalid Splits' THEN 2
          WHEN CASE
            WHEN verification_status = 'pending_metadata' THEN 'Pending Metadata'
            WHEN verification_status = 'claimed' AND is_valid = false THEN 'Claimed but Invalid Splits'
            WHEN verification_status = 'claimed' AND is_valid = true THEN 'Claimed and Valid'
            WHEN verification_status = 'unclaimed' AND is_valid = false THEN 'Unclaimed but Invalid'
            WHEN verification_status = 'unclaimed' AND is_valid = true THEN 'Unclaimed but Valid'
            ELSE 'Other'
          END = 'Pending Metadata' THEN 3
          WHEN CASE
            WHEN verification_status = 'pending_metadata' THEN 'Pending Metadata'
            WHEN verification_status = 'claimed' AND is_valid = false THEN 'Claimed but Invalid Splits'
            WHEN verification_status = 'claimed' AND is_valid = true THEN 'Claimed and Valid'
            WHEN verification_status = 'unclaimed' AND is_valid = false THEN 'Unclaimed but Invalid'
            WHEN verification_status = 'unclaimed' AND is_valid = true THEN 'Unclaimed but Valid'
            ELSE 'Other'
          END = 'Unclaimed but Valid' THEN 4
          WHEN CASE
            WHEN verification_status = 'pending_metadata' THEN 'Pending Metadata'
            WHEN verification_status = 'claimed' AND is_valid = false THEN 'Claimed but Invalid Splits'
            WHEN verification_status = 'claimed' AND is_valid = true THEN 'Claimed and Valid'
            WHEN verification_status = 'unclaimed' AND is_valid = false THEN 'Unclaimed but Invalid'
            WHEN verification_status = 'unclaimed' AND is_valid = true THEN 'Unclaimed but Valid'
            ELSE 'Other'
          END = 'Unclaimed but Invalid' THEN 5
          ELSE 6
        END
    `,
    );

    if (claimedStatsResult.rows.length === 0) {
      console.log(chalk.dim('  No projects with claimed_at set'));
    } else {
      console.table(claimedStatsResult.rows);
    }
    console.log();

    // 4. Projects with Invalid Splits.
    console.log(
      boxen(chalk.bold('Projects with Invalid Splits'), {
        padding: 1,
        borderColor: 'red',
        borderStyle: 'round',
      }),
    );
    console.log();

    const invalidSplitsResult = await pool.query<{
      accountId: string;
      name: string | null;
      count: number;
    }>(
      `
      SELECT
        account_id as "accountId",
        name,
        1 as count
      FROM ${validatedSchema}.projects
      WHERE is_valid = false
      ORDER BY created_at DESC
    `,
    );

    if (invalidSplitsResult.rows.length === 0) {
      console.log(`  ${chalk.green('✓ No projects with invalid splits')}`);
    } else {
      const displayRows = invalidSplitsResult.rows.map((row) => ({
        accountId: row.accountId,
        name: row.name || 'N/A',
      }));
      console.table(displayRows);
      console.log(
        `  ${chalk.red(`⚠️  ${invalidSplitsResult.rows.length} project(s) with invalid splits`)}`,
      );
    }
    console.log();

    // 5. Hidden Projects (Not Visible).
    console.log(
      boxen(chalk.bold('Hidden Projects (Not Visible)'), {
        padding: 1,
        borderColor: 'yellow',
        borderStyle: 'round',
      }),
    );
    console.log();

    const hiddenResult = await pool.query<{
      accountId: string;
      name: string | null;
      count: number;
    }>(
      `
      SELECT
        account_id as "accountId",
        name,
        1 as count
      FROM ${validatedSchema}.projects
      WHERE is_visible = false
      ORDER BY created_at DESC
    `,
    );

    if (hiddenResult.rows.length === 0) {
      console.log(`  ${chalk.green('✓ No hidden projects')}`);
    } else {
      const displayRows = hiddenResult.rows.map((row) => ({
        accountId: row.accountId,
        name: row.name || 'N/A',
      }));
      console.table(displayRows);
      console.log(`  ${chalk.yellow(`⚠️  ${hiddenResult.rows.length} hidden project(s)`)}`);
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

    const validAndVisibleProjects = stats.validSplits && stats.visible ? stats.validSplits : 0;
    const validAndVisiblePercentage = ((validAndVisibleProjects / stats.total) * 100).toFixed(1);

    const summaryTable = new Table({
      head: [chalk.cyan('Metric'), chalk.cyan('Value')],
      style: { head: [] },
    });

    summaryTable.push(
      ['Total Projects', chalk.bold(formatNumber(stats.total))],
      [
        'Claimed',
        `${chalk.bold(formatNumber(stats.claimed))} (${((stats.claimed / stats.total) * 100).toFixed(1)}%)`,
      ],
      [
        'Valid & Visible',
        `${chalk.green.bold(formatNumber(validAndVisibleProjects))} (${validAndVisiblePercentage}%)`,
      ],
    );

    console.log(summaryTable.toString());
    console.log();

    if (stats.invalidSplits > 0 || stats.notVisible > 0) {
      console.log(chalk.yellow('Issues detected:'));
      if (stats.invalidSplits > 0) {
        console.log(`  ${chalk.red(`⚠️  ${stats.invalidSplits} project(s) with invalid splits`)}`);
      }
      if (stats.notVisible > 0) {
        console.log(`  ${chalk.yellow(`⚠️  ${stats.notVisible} project(s) not visible`)}`);
      }
      console.log();
    } else {
      console.log(chalk.green('✓ All projects are valid and visible!'));
      console.log();
    }
  } catch (error) {
    console.log();
    console.log(
      boxen(chalk.bold.red('✗ Projects info query failed!'), {
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
  .name('info:projects')
  .description('Display comprehensive information about projects in the database')
  .requiredOption('--db-url <url>', 'Database connection URL')
  .requiredOption('--schema <name>', 'Database schema name')
  .requiredOption('--network <name>', 'Network name (e.g., optimism, mainnet)')
  .action(main);

program.parse();
