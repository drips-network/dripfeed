import { config as dotenvConfig } from 'dotenv';
import { expand } from 'dotenv-expand';
import { Pool } from 'pg';

expand(dotenvConfig());

type DripListStats = {
  total: number;
  valid: number;
  invalid: number;
  visible: number;
  notVisible: number;
  withVotingRound: number;
};

const COLORS = {
  RED: '\x1b[0;31m',
  YELLOW: '\x1b[1;33m',
  GREEN: '\x1b[0;32m',
  GREEN_BOLD: '\x1b[1;32m',
  BLUE: '\x1b[0;34m',
  CYAN: '\x1b[0;36m',
  NC: '\x1b[0m',
};

function formatDate(date: Date | null): string {
  if (!date) return 'N/A';
  return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

async function main(dbUrl: string, schema: string): Promise<void> {
  const pool = new Pool({ connectionString: dbUrl });

  try {
    console.log(`${COLORS.BLUE}=== Drip Lists Dashboard ===${COLORS.NC}`);
    console.log(`Database: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`);
    console.log(`Schema: ${schema}`);
    console.log(`Time: ${formatDate(new Date())}`);
    console.log('');

    try {
      await pool.query('SELECT 1');
    } catch (error) {
      console.log(`${COLORS.RED}❌ Cannot connect to database${COLORS.NC}`);
      console.error(error);
      process.exit(1);
    }

    console.log(`${COLORS.BLUE}=== Overall Statistics ===${COLORS.NC}`);
    const statsResult = await pool.query<DripListStats>(
      `
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE is_valid = true)::int as valid,
        COUNT(*) FILTER (WHERE is_valid = false)::int as invalid,
        COUNT(*) FILTER (WHERE is_visible = true)::int as visible,
        COUNT(*) FILTER (WHERE is_visible = false)::int as "notVisible",
        COUNT(*) FILTER (WHERE latest_voting_round_id IS NOT NULL)::int as "withVotingRound"
      FROM ${schema}.drip_lists
    `,
    );

    const stats = statsResult.rows[0];
    if (!stats || stats.total === 0) {
      console.log('  No drip lists found');
      return;
    }

    console.log(`  Total Drip Lists: ${COLORS.GREEN}${stats.total}${COLORS.NC}`);
    console.log('');
    console.log(`  ${COLORS.CYAN}Validity:${COLORS.NC}`);
    console.log(
      `    Valid: ${COLORS.GREEN}${stats.valid}${COLORS.NC} (${((stats.valid / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `    Invalid: ${COLORS.RED}${stats.invalid}${COLORS.NC} (${((stats.invalid / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log('');
    console.log(`  ${COLORS.CYAN}Visibility:${COLORS.NC}`);
    console.log(
      `    Visible: ${COLORS.GREEN}${stats.visible}${COLORS.NC} (${((stats.visible / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `    Not Visible: ${COLORS.YELLOW}${stats.notVisible}${COLORS.NC} (${((stats.notVisible / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log('');
    console.log(`  ${COLORS.CYAN}Voting Rounds:${COLORS.NC}`);
    console.log(
      `    With Voting Round: ${COLORS.GREEN}${stats.withVotingRound}${COLORS.NC} (${((stats.withVotingRound / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log('');

    console.log(`${COLORS.BLUE}=== Drip Lists with Invalid Splits ===${COLORS.NC}`);
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
      FROM ${schema}.drip_lists dl
      LEFT JOIN ${schema}.splits_receivers sr ON sr.sender_account_id = dl.account_id
        AND sr.relationship_type = 'drip_list_receiver'
      WHERE dl.is_valid = false
      GROUP BY dl.account_id
      ORDER BY dl.created_at DESC
    `,
    );

    if (invalidSplitsResult.rows.length === 0) {
      console.log(`  ${COLORS.GREEN}✓ No drip lists with invalid splits${COLORS.NC}`);
    } else {
      const displayRows = invalidSplitsResult.rows.map((row) => ({
        accountId: row.accountId,
        name: row.name || 'N/A',
        receivers: row.receiverCount,
      }));
      console.table(displayRows);
      console.log(
        `  ${COLORS.RED}⚠️  ${invalidSplitsResult.rows.length} drip list(s) with invalid splits${COLORS.NC}`,
      );
    }
    console.log('');

    console.log(`${COLORS.BLUE}=== Hidden Drip Lists (Not Visible) ===${COLORS.NC}`);
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
      FROM ${schema}.drip_lists dl
      LEFT JOIN ${schema}.splits_receivers sr ON sr.sender_account_id = dl.account_id
        AND sr.relationship_type = 'drip_list_receiver'
      WHERE dl.is_visible = false
      GROUP BY dl.account_id
      ORDER BY dl.created_at DESC
    `,
    );

    if (hiddenResult.rows.length === 0) {
      console.log(`  ${COLORS.GREEN}✓ No hidden drip lists${COLORS.NC}`);
    } else {
      const displayRows = hiddenResult.rows.map((row) => ({
        accountId: row.accountId,
        name: row.name || 'N/A',
        receivers: row.receiverCount,
      }));
      console.table(displayRows);
      console.log(
        `  ${COLORS.YELLOW}⚠️  ${hiddenResult.rows.length} hidden drip list(s)${COLORS.NC}`,
      );
    }
    console.log('');

    console.log(`${COLORS.BLUE}=== Summary ===${COLORS.NC}`);
    const validAndVisibleDripLists = stats.valid && stats.visible ? stats.valid : 0;
    const validAndVisiblePercentage = ((validAndVisibleDripLists / stats.total) * 100).toFixed(1);

    console.log(`  Total Drip Lists: ${stats.total}`);
    console.log(
      `  ${COLORS.GREEN_BOLD}✓ Valid & Visible: ${validAndVisibleDripLists}${COLORS.NC} (${validAndVisiblePercentage}%)`,
    );

    if (stats.invalid > 0) {
      console.log(
        `  ${COLORS.RED}⚠️  ${stats.invalid} drip list(s) with invalid splits${COLORS.NC}`,
      );
    }
    if (stats.notVisible > 0) {
      console.log(`  ${COLORS.YELLOW}⚠️  ${stats.notVisible} drip list(s) not visible${COLORS.NC}`);
    }
  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Main execution.
const args = process.argv.slice(2);
const dbUrl = args[0] || process.env.DATABASE_URL;
const schema = args[1] || process.env.NETWORK || 'public';

if (!dbUrl) {
  console.error(
    `${COLORS.RED}Error: DATABASE_URL environment variable is not set and no db_url argument provided${COLORS.NC}`,
  );
  console.error();
  console.error(`${COLORS.CYAN}Usage: tsx scripts/drip-lists-info.ts [db_url] [schema]${COLORS.NC}`);
  console.error();
  console.error(`${COLORS.CYAN}Examples:${COLORS.NC}`);
  console.error(`  tsx scripts/drip-lists-info.ts`);
  console.error(`  tsx scripts/drip-lists-info.ts "postgresql://user:pass@host:5432/db"`);
  console.error(`  tsx scripts/drip-lists-info.ts "postgresql://user:pass@host:5432/db" filecoin`);
  console.error();
  console.error(`${COLORS.CYAN}Environment Variables:${COLORS.NC}`);
  console.error(`  DATABASE_URL     - Database connection string (default: from .env)`);
  console.error(`  NETWORK          - Schema to query (default: public)`);
  process.exit(1);
}

main(dbUrl, schema).catch((error: Error) => {
  console.error(`${COLORS.RED}Error:${COLORS.NC}`, error.message);
  process.exit(1);
});
