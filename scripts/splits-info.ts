import { Pool } from 'pg';

import { config } from '../src/config.js';

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

const COLORS = {
  RED: '\x1b[0;31m',
  YELLOW: '\x1b[1;33m',
  GREEN: '\x1b[0;32m',
  BLUE: '\x1b[0;34m',
  CYAN: '\x1b[0;36m',
  MAGENTA: '\x1b[0;35m',
  NC: '\x1b[0m',
};

function formatDate(date: Date | null): string {
  if (!date) return 'N/A';
  return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

function formatWeight(weight: number): string {
  // Weights are typically represented as parts per million (1000000 = 100%).
  const percentage = (weight / 1000000) * 100;
  return `${percentage.toFixed(2)}%`;
}

async function main(): Promise<void> {
  const accountId = process.argv[2];

  if (!accountId) {
    console.log(`${COLORS.RED}❌ Error: Account ID is required${COLORS.NC}`);
    console.log(`Usage: npm run splits-info <account_id>`);
    process.exit(1);
  }

  const schema = config.database.schema;
  const pool = new Pool({ connectionString: config.database.url });

  try {
    console.log(`${COLORS.BLUE}=== Splits Receivers Information ===${COLORS.NC}`);
    console.log(`Account ID: ${accountId}`);
    console.log(`Schema: ${schema}`);
    console.log(`Time: ${formatDate(new Date())}`);
    console.log('');

    // Check database connection.
    try {
      await pool.query('SELECT 1');
    } catch (error) {
      console.log(`${COLORS.RED}❌ Cannot connect to database${COLORS.NC}`);
      console.error(error);
      process.exit(1);
    }

    // 1. Overall Statistics.
    console.log(`${COLORS.BLUE}=== Overall Statistics ===${COLORS.NC}`);
    const statsResult = await pool.query<SplitsStats>(
      `
      SELECT
        COUNT(*)::int as "totalReceivers",
        COALESCE(SUM(weight), 0)::int as "totalWeight",
        MAX(block_timestamp) as "lastUpdated"
      FROM ${schema}.splits_receivers
      WHERE sender_account_id = $1
    `,
      [accountId],
    );

    const stats = statsResult.rows[0];
    if (!stats || stats.totalReceivers === 0) {
      console.log(`  ${COLORS.YELLOW}No splits receivers found for this account${COLORS.NC}`);
      return;
    }

    console.log(`  Total Receivers: ${COLORS.GREEN}${stats.totalReceivers}${COLORS.NC}`);
    console.log(`  Total Weight: ${COLORS.CYAN}${formatWeight(stats.totalWeight)}${COLORS.NC}`);
    console.log(`  Last Updated: ${formatDate(stats.lastUpdated)}`);
    console.log('');

    // 2. Receivers by Type.
    console.log(`${COLORS.BLUE}=== Receivers by Type ===${COLORS.NC}`);
    const byTypeResult = await pool.query<ReceiverByType>(
      `
      SELECT
        receiver_account_type as "receiverAccountType",
        COUNT(*)::int as count,
        SUM(weight)::int as "totalWeight"
      FROM ${schema}.splits_receivers
      WHERE sender_account_id = $1
      GROUP BY receiver_account_type
      ORDER BY "totalWeight" DESC
    `,
      [accountId],
    );

    if (byTypeResult.rows.length === 0) {
      console.log('  No data');
    } else {
      const displayRows = byTypeResult.rows.map((row) => ({
        type: row.receiverAccountType,
        count: row.count,
        weight: formatWeight(row.totalWeight),
      }));
      console.table(displayRows);
    }
    console.log('');

    // 3. Receivers by Relationship.
    console.log(`${COLORS.BLUE}=== Receivers by Relationship ===${COLORS.NC}`);
    const byRelationshipResult = await pool.query<ReceiverByRelationship>(
      `
      SELECT
        relationship_type as "relationshipType",
        COUNT(*)::int as count,
        SUM(weight)::int as "totalWeight"
      FROM ${schema}.splits_receivers
      WHERE sender_account_id = $1
      GROUP BY relationship_type
      ORDER BY "totalWeight" DESC
    `,
      [accountId],
    );

    if (byRelationshipResult.rows.length === 0) {
      console.log('  No data');
    } else {
      const displayRows = byRelationshipResult.rows.map((row) => ({
        relationship: row.relationshipType,
        count: row.count,
        weight: formatWeight(row.totalWeight),
      }));
      console.table(displayRows);
    }
    console.log('');

    // 4. Detailed Receivers List.
    console.log(`${COLORS.BLUE}=== Detailed Receivers List ===${COLORS.NC}`);
    const receiversResult = await pool.query<SplitsReceiver>(
      `
      SELECT
        receiver_account_id as "receiverAccountId",
        receiver_account_type as "receiverAccountType",
        relationship_type as "relationshipType",
        weight,
        block_timestamp as "blockTimestamp",
        splits_to_repo_driver_sub_account as "splitsToRepoDriverSubAccount"
      FROM ${schema}.splits_receivers
      WHERE sender_account_id = $1
      ORDER BY weight DESC
    `,
      [accountId],
    );

    if (receiversResult.rows.length === 0) {
      console.log('  No receivers');
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
    console.log('');

    // 5. Matrix: Type x Relationship.
    console.log(`${COLORS.BLUE}=== Matrix: Type × Relationship ===${COLORS.NC}`);
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
      FROM ${schema}.splits_receivers
      WHERE sender_account_id = $1
      GROUP BY receiver_account_type, relationship_type
      ORDER BY receiver_account_type, relationship_type
    `,
      [accountId],
    );

    if (matrixResult.rows.length === 0) {
      console.log('  No data');
    } else {
      const displayRows = matrixResult.rows.map((row) => ({
        type: row.receiverAccountType,
        relationship: row.relationshipType,
        count: row.count,
        weight: formatWeight(row.totalWeight),
      }));
      console.table(displayRows);
    }
    console.log('');

    // 6. Summary.
    console.log(`${COLORS.BLUE}=== Summary ===${COLORS.NC}`);
    console.log(`  Account ID: ${accountId}`);
    console.log(`  Total Receivers: ${stats.totalReceivers}`);
    console.log(`  Total Weight: ${formatWeight(stats.totalWeight)}`);

    if (stats.totalWeight !== 1000000) {
      const diff = 1000000 - stats.totalWeight;
      const diffPercent = (diff / 1000000) * 100;
      if (diff > 0) {
        console.log(
          `  ${COLORS.YELLOW}⚠️  Weight is ${formatWeight(diff)} (${diffPercent.toFixed(2)}%) under 100%${COLORS.NC}`,
        );
      } else {
        console.log(
          `  ${COLORS.RED}⚠️  Weight is ${formatWeight(-diff)} (${Math.abs(diffPercent).toFixed(2)}%) over 100%${COLORS.NC}`,
        );
      }
    } else {
      console.log(`  ${COLORS.GREEN}✓ Weight is exactly 100%${COLORS.NC}`);
    }
  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
