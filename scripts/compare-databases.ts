/**
 * SCRIPT: Compare Databases
 *
 * Compares drip lists and projects between two databases to identify differences,
 * inconsistencies, and records that exist in one database but not the other.
 * Used for ensuring data integrity during hard (DB) refactorings.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';
import { Pool } from 'pg';

import { validateSchemaName } from '../src/utils/sqlValidation.js';

import { configureScriptLogger } from './shared/configure-logger.js';
import { formatNumber } from './shared/formatting.js';

// Configure logger for debug output.
configureScriptLogger();

interface CompareOptions {
  oldDbUrl: string;
  newDbUrl: string;
  oldSchema: string;
  newSchema: string;
}

type DripListRow = {
  account_id: string;
  is_valid: boolean;
  owner_address: string;
  owner_account_id: string;
  name: string | null;
  latest_voting_round_id: string | null;
  description: string | null;
  creator: string | null;
  previous_owner_address: string | null;
  is_visible: boolean;
};

type ProjectRow = {
  account_id: string;
  name: string | null;
  is_valid: boolean;
  is_visible: boolean;
  verification_status: string;
  owner_address: string | null;
  owner_account_id: string | null;
  claimed_at: Date | null;
  url: string | null;
  forge: string | null;
  emoji: string | null;
  color: string | null;
  avatar_cid: string | null;
};

type FieldComparison = {
  field: string;
  oldValue: unknown;
  newValue: unknown;
};

type Inconsistency = {
  accountId: string;
  name: string | null;
  differences: FieldComparison[];
};

function compareValues(oldValue: unknown, newValue: unknown): boolean {
  if (oldValue === null && newValue === null) return true;
  if (oldValue === undefined && newValue === null) return true;
  if (oldValue === null && newValue === undefined) return true;
  if (oldValue === '' && newValue === null) return true;
  if (oldValue === null && newValue === '') return true;
  return oldValue === newValue;
}

function compareDripLists(
  oldLists: Map<string, DripListRow>,
  newLists: Map<string, DripListRow>,
): {
  onlyInOld: string[];
  onlyInNew: string[];
  inconsistencies: Inconsistency[];
} {
  const onlyInOld: string[] = [];
  const onlyInNew: string[] = [];
  const inconsistencies: Inconsistency[] = [];

  for (const [accountId, oldList] of oldLists) {
    if (!newLists.has(accountId)) {
      onlyInOld.push(accountId);
      continue;
    }

    const newList = newLists.get(accountId)!;
    const differences: FieldComparison[] = [];

    const fieldsToCompare: (keyof DripListRow)[] = [
      'is_valid',
      'owner_address',
      'owner_account_id',
      'name',
      'latest_voting_round_id',
      'description',
      'creator',
      'previous_owner_address',
      'is_visible',
    ];

    for (const field of fieldsToCompare) {
      const oldValue = oldList[field];
      const newValue = newList[field];

      // Skip if old is null but new has a value.
      if (oldValue === null && newValue !== null) {
        continue;
      }

      if (!compareValues(oldValue, newValue)) {
        differences.push({
          field,
          oldValue,
          newValue,
        });
      }
    }

    if (differences.length > 0) {
      inconsistencies.push({
        accountId,
        name: oldList.name,
        differences,
      });
    }
  }

  for (const accountId of newLists.keys()) {
    if (!oldLists.has(accountId)) {
      onlyInNew.push(accountId);
    }
  }

  return { onlyInOld, onlyInNew, inconsistencies };
}

type ProjectInconsistency = Inconsistency & {
  oldProject: ProjectRow;
  newProject: ProjectRow;
};

function compareProjects(
  oldProjects: Map<string, ProjectRow>,
  newProjects: Map<string, ProjectRow>,
): {
  onlyInOld: string[];
  onlyInNew: string[];
  inconsistencies: ProjectInconsistency[];
} {
  const onlyInOld: string[] = [];
  const onlyInNew: string[] = [];
  const inconsistencies: ProjectInconsistency[] = [];

  for (const [accountId, oldProject] of oldProjects) {
    if (!newProjects.has(accountId)) {
      onlyInOld.push(accountId);
      continue;
    }

    const newProject = newProjects.get(accountId)!;
    const differences: FieldComparison[] = [];

    const fieldsToCompare: (keyof ProjectRow)[] = [
      'name',
      'is_valid',
      'is_visible',
      'verification_status',
      'owner_address',
      'owner_account_id',
      'claimed_at',
      'url',
      'forge',
      'emoji',
      'color',
      'avatar_cid',
    ];

    for (const field of fieldsToCompare) {
      const oldValue = oldProject[field];
      const newValue = newProject[field];

      // Skip if old is null but new has a value.
      if (oldValue === null && newValue !== null) {
        continue;
      }

      if (field === 'claimed_at') {
        const oldDate = oldValue as Date | null;
        const newDate = newValue as Date | null;

        if (oldDate === null && newDate === null) {
          continue;
        }

        if (oldDate !== null && newDate === null) {
          differences.push({
            field,
            oldValue: oldDate.toISOString(),
            newValue: null,
          });
        } else if (oldDate && newDate) {
          const oldDateOnly = oldDate.toISOString().split('T')[0];
          const newDateOnly = newDate.toISOString().split('T')[0];

          if (oldDateOnly !== newDateOnly) {
            differences.push({
              field,
              oldValue: oldDate.toISOString(),
              newValue: newDate.toISOString(),
            });
          }
        }
      } else if (!compareValues(oldValue, newValue)) {
        differences.push({
          field,
          oldValue,
          newValue,
        });
      }
    }

    if (differences.length > 0) {
      inconsistencies.push({
        accountId,
        name: oldProject.name,
        differences,
        oldProject,
        newProject,
      });
    }
  }

  for (const accountId of newProjects.keys()) {
    if (!oldProjects.has(accountId)) {
      onlyInNew.push(accountId);
    }
  }

  return { onlyInOld, onlyInNew, inconsistencies };
}

function printDripListResults(
  oldCount: number,
  newCount: number,
  onlyInOld: string[],
  onlyInNew: string[],
  inconsistencies: Inconsistency[],
): void {
  console.log(
    boxen(chalk.bold('Drip Lists Comparison'), {
      padding: 1,
      borderColor: 'blue',
      borderStyle: 'round',
    }),
  );
  console.log();

  const summaryTable = new Table({
    head: [chalk.cyan('Metric'), chalk.cyan('Count')],
    style: { head: [] },
  });

  summaryTable.push(
    ['Old DB Total', formatNumber(oldCount)],
    ['New DB Total', formatNumber(newCount)],
    [
      'Only in Old',
      onlyInOld.length > 0 ? chalk.red(formatNumber(onlyInOld.length)) : chalk.green('0'),
    ],
    [
      'Only in New',
      onlyInNew.length > 0 ? chalk.yellow(formatNumber(onlyInNew.length)) : chalk.green('0'),
    ],
    [
      'Inconsistencies',
      inconsistencies.length > 0
        ? chalk.red(formatNumber(inconsistencies.length))
        : chalk.green('0'),
    ],
  );

  console.log(summaryTable.toString());
  console.log();

  if (onlyInOld.length > 0) {
    console.log(chalk.red.bold('Drip Lists only in OLD database:'));
    onlyInOld.forEach((id) => console.log(`  - ${id}`));
    console.log();
  }

  if (onlyInNew.length > 0) {
    console.log(chalk.yellow.bold('Drip Lists only in NEW database:'));
    onlyInNew.forEach((id) => console.log(`  - ${id}`));
    console.log();
  }

  if (inconsistencies.length > 0) {
    console.log(chalk.red.bold('Drip Lists with inconsistencies:'));
    inconsistencies.forEach((inc) => {
      const nameDisplay = inc.name ? ` (${inc.name})` : '';
      console.log(`  ${chalk.magenta(`${inc.accountId}${nameDisplay}`)}:`);
      inc.differences.forEach((diff) => {
        console.log(`    ${diff.field}:`);
        console.log(`      OLD: ${chalk.red(JSON.stringify(diff.oldValue))}`);
        console.log(`      NEW: ${chalk.green(JSON.stringify(diff.newValue))}`);
      });
    });
    console.log();
  }
}

function printProjectResults(
  oldCount: number,
  newCount: number,
  onlyInOld: string[],
  onlyInNew: string[],
  inconsistencies: ProjectInconsistency[],
): void {
  console.log(
    boxen(chalk.bold('Projects Comparison'), {
      padding: 1,
      borderColor: 'blue',
      borderStyle: 'round',
    }),
  );
  console.log();

  const summaryTable = new Table({
    head: [chalk.cyan('Metric'), chalk.cyan('Count')],
    style: { head: [] },
  });

  summaryTable.push(
    ['Old DB Total', formatNumber(oldCount)],
    ['New DB Total', formatNumber(newCount)],
    [
      'Only in Old',
      onlyInOld.length > 0 ? chalk.red(formatNumber(onlyInOld.length)) : chalk.green('0'),
    ],
    [
      'Only in New',
      onlyInNew.length > 0 ? chalk.yellow(formatNumber(onlyInNew.length)) : chalk.green('0'),
    ],
    [
      'Inconsistencies',
      inconsistencies.length > 0
        ? chalk.red(formatNumber(inconsistencies.length))
        : chalk.green('0'),
    ],
  );

  console.log(summaryTable.toString());
  console.log();

  if (onlyInOld.length > 0) {
    console.log(chalk.red.bold('Projects only in OLD database:'));
    onlyInOld.forEach((id) => console.log(`  - ${id}`));
    console.log();
  }

  if (onlyInNew.length > 0) {
    console.log(chalk.yellow.bold('Projects only in NEW database:'));
    onlyInNew.forEach((id) => console.log(`  - ${id}`));
    console.log();
  }

  if (inconsistencies.length > 0) {
    console.log(chalk.red.bold('Projects with inconsistencies:'));
    inconsistencies.forEach((inc) => {
      const nameDisplay = inc.name ? ` (${inc.name})` : '';
      console.log(`  ${chalk.magenta(`${inc.accountId}${nameDisplay}`)}:`);
      inc.differences.forEach((diff) => {
        console.log(`    ${diff.field}:`);
        console.log(`      OLD: ${chalk.red(JSON.stringify(diff.oldValue))}`);
        console.log(`      NEW: ${chalk.green(JSON.stringify(diff.newValue))}`);

        // Show avatar_cid values when emoji differs.
        if (diff.field === 'emoji') {
          console.log(`    avatar_cid (for context):`);
          console.log(`      OLD: ${chalk.red(JSON.stringify(inc.oldProject.avatar_cid))}`);
          console.log(`      NEW: ${chalk.green(JSON.stringify(inc.newProject.avatar_cid))}`);
        }
      });
    });
    console.log();
  }
}

async function main(options: CompareOptions): Promise<void> {
  const { oldDbUrl, newDbUrl, oldSchema, newSchema } = options;

  // Display header.
  console.log(
    boxen(chalk.bold.blue('🔄 DATABASE COMPARISON TOOL 🔄'), {
      padding: 1,
      borderColor: 'blue',
      borderStyle: 'double',
    }),
  );
  console.log();

  // Display connection info.
  console.log(
    boxen(chalk.bold('Database Connections'), {
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
    [chalk.cyan('Old DB URL'), oldDbUrl.replace(/:[^:@]+@/, ':***@')],
    [chalk.cyan('Old Schema'), chalk.bold(oldSchema)],
    [chalk.cyan('New DB URL'), newDbUrl.replace(/:[^:@]+@/, ':***@')],
    [chalk.cyan('New Schema'), chalk.bold(newSchema)],
  );

  console.log(connectionTable.toString());
  console.log();

  const oldSchemaName = validateSchemaName(oldSchema);
  const newSchemaName = validateSchemaName(newSchema);
  const oldPool = new Pool({ connectionString: oldDbUrl });
  const newPool = new Pool({ connectionString: newDbUrl });

  try {
    console.log(chalk.cyan('Connecting to databases...'));
    console.log();

    try {
      await oldPool.query('SELECT 1');
      console.log(chalk.green('✓ Connected to OLD database'));
    } catch (error) {
      console.log(chalk.red('✗ Cannot connect to OLD database'));
      throw error;
    }

    try {
      await newPool.query('SELECT 1');
      console.log(chalk.green('✓ Connected to NEW database'));
    } catch (error) {
      console.log(chalk.red('✗ Cannot connect to NEW database'));
      throw error;
    }
    console.log();

    console.log(chalk.cyan('Fetching drip lists from OLD database...'));
    const oldDripListsResult = await oldPool.query<DripListRow>(`
      SELECT
        account_id,
        is_valid,
        owner_address,
        owner_account_id,
        name,
        latest_voting_round_id,
        description,
        creator,
        previous_owner_address,
        is_visible
      FROM ${oldSchemaName}.drip_lists
    `);
    const oldDripLists = new Map(oldDripListsResult.rows.map((row) => [row.account_id, row]));
    console.log(chalk.green(`✓ Fetched ${formatNumber(oldDripLists.size)} drip lists`));

    console.log(chalk.cyan('Fetching drip lists from NEW database...'));
    const newDripListsResult = await newPool.query<DripListRow>(`
      SELECT
        account_id,
        is_valid,
        owner_address,
        owner_account_id,
        name,
        latest_voting_round_id,
        description,
        creator,
        previous_owner_address,
        is_visible
      FROM ${newSchemaName}.drip_lists
    `);
    const newDripLists = new Map(newDripListsResult.rows.map((row) => [row.account_id, row]));
    console.log(chalk.green(`✓ Fetched ${formatNumber(newDripLists.size)} drip lists`));
    console.log();

    const dripListComparison = compareDripLists(oldDripLists, newDripLists);
    printDripListResults(
      oldDripLists.size,
      newDripLists.size,
      dripListComparison.onlyInOld,
      dripListComparison.onlyInNew,
      dripListComparison.inconsistencies,
    );

    console.log(chalk.cyan('Fetching projects from OLD database...'));
    const oldProjectsResult = await oldPool.query<ProjectRow>(`
      SELECT
        account_id,
        name,
        is_valid,
        is_visible,
        verification_status,
        owner_address,
        owner_account_id,
        claimed_at,
        url,
        forge,
        emoji,
        color,
        avatar_cid
      FROM ${oldSchemaName}.projects
    `);
    const oldProjects = new Map(oldProjectsResult.rows.map((row) => [row.account_id, row]));
    console.log(chalk.green(`✓ Fetched ${formatNumber(oldProjects.size)} projects`));

    console.log(chalk.cyan('Fetching projects from NEW database...'));
    const newProjectsResult = await newPool.query<ProjectRow>(`
      SELECT
        account_id,
        name,
        is_valid,
        is_visible,
        verification_status,
        owner_address,
        owner_account_id,
        claimed_at,
        url,
        forge,
        emoji,
        color,
        avatar_cid
      FROM ${newSchemaName}.projects
    `);
    const newProjects = new Map(newProjectsResult.rows.map((row) => [row.account_id, row]));
    console.log(chalk.green(`✓ Fetched ${formatNumber(newProjects.size)} projects`));
    console.log();

    const projectComparison = compareProjects(oldProjects, newProjects);
    printProjectResults(
      oldProjects.size,
      newProjects.size,
      projectComparison.onlyInOld,
      projectComparison.onlyInNew,
      projectComparison.inconsistencies,
    );

    console.log(
      boxen(chalk.bold('Summary'), {
        padding: 1,
        borderColor: 'yellow',
        borderStyle: 'round',
      }),
    );
    console.log();

    const totalIssues =
      dripListComparison.onlyInOld.length +
      dripListComparison.onlyInNew.length +
      dripListComparison.inconsistencies.length +
      projectComparison.onlyInOld.length +
      projectComparison.onlyInNew.length +
      projectComparison.inconsistencies.length;

    if (totalIssues === 0) {
      console.log(chalk.green.bold('✓ Databases are in sync!'));
    } else {
      console.log(chalk.red(`⚠️  Found ${formatNumber(totalIssues)} total issues`));
    }
    console.log();
  } catch (error) {
    console.log();
    console.log(
      boxen(chalk.bold.red('✗ Comparison failed!'), {
        padding: 1,
        borderColor: 'red',
        borderStyle: 'round',
      }),
    );
    console.log();
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await oldPool.end();
    await newPool.end();
  }
}

// CLI setup.
const program = new Command();

program
  .name('compare-databases')
  .description('Compare drip lists and projects between two databases')
  .requiredOption('--old-db-url <url>', 'OLD database connection URL')
  .requiredOption('--old-schema <name>', 'OLD database schema name')
  .requiredOption('--new-db-url <url>', 'NEW database connection URL')
  .requiredOption('--new-schema <name>', 'NEW database schema name')
  .action(main);

program.parse();
