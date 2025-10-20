import { Pool } from 'pg';

import { config } from '../src/config.js';

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

async function main(): Promise<void> {
  const schema = config.database.schema;
  const pool = new Pool({ connectionString: config.database.url });

  try {
    console.log(`${COLORS.BLUE}=== Project Information Dashboard ===${COLORS.NC}`);
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
      FROM ${schema}.projects
    `,
    );

    const stats = statsResult.rows[0];
    if (!stats || stats.total === 0) {
      console.log('  No projects found');
      return;
    }

    console.log(`  Total Projects: ${COLORS.GREEN}${stats.total}${COLORS.NC}`);
    console.log('');
    console.log(`  ${COLORS.CYAN}Verification Status:${COLORS.NC}`);
    console.log(
      `    Claimed: ${COLORS.GREEN}${stats.claimed}${COLORS.NC} (${((stats.claimed / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `    Unclaimed: ${COLORS.YELLOW}${stats.unclaimed}${COLORS.NC} (${((stats.unclaimed / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `    Pending Metadata: ${COLORS.MAGENTA}${stats.pendingMetadata}${COLORS.NC} (${((stats.pendingMetadata / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log('');
    console.log(`  ${COLORS.CYAN}Splits Validity:${COLORS.NC}`);
    console.log(
      `    Valid: ${COLORS.GREEN}${stats.validSplits}${COLORS.NC} (${((stats.validSplits / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `    Invalid: ${COLORS.RED}${stats.invalidSplits}${COLORS.NC} (${((stats.invalidSplits / stats.total) * 100).toFixed(1)}%)`,
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
    console.log(`  ${COLORS.CYAN}Forge Distribution:${COLORS.NC}`);
    console.log(
      `    GitHub: ${COLORS.GREEN}${stats.github}${COLORS.NC} (${((stats.github / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `    GitLab: ${COLORS.BLUE}${stats.gitlab}${COLORS.NC} (${((stats.gitlab / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `    None: ${COLORS.YELLOW}${stats.noForge}${COLORS.NC} (${((stats.noForge / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log('');

    // 2. Combinations Matrix.
    console.log(`${COLORS.BLUE}=== Status Combinations ===${COLORS.NC}`);
    const combinationsResult = await pool.query<ProjectCombination>(
      `
      SELECT
        verification_status as "verificationStatus",
        is_valid as "areSplitsValid",
        is_visible as "isVisible",
        COUNT(*)::int as count
      FROM ${schema}.projects
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
    console.log('');

    // 3. Claimed Projects Breakdown (claimed_at IS NOT NULL).
    console.log(`${COLORS.BLUE}=== Claimed Projects Breakdown (by claimed_at) ===${COLORS.NC}`);
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
      FROM ${schema}.projects
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
      console.log('  No projects with claimed_at set');
    } else {
      console.table(claimedStatsResult.rows);
    }
    console.log('');

    // 4. Projects with Invalid Splits.
    console.log(`${COLORS.BLUE}=== Projects with Invalid Splits ===${COLORS.NC}`);
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
      FROM ${schema}.projects
      WHERE is_valid = false
      ORDER BY created_at DESC
    `,
    );

    if (invalidSplitsResult.rows.length === 0) {
      console.log(`  ${COLORS.GREEN}✓ No projects with invalid splits${COLORS.NC}`);
    } else {
      const displayRows = invalidSplitsResult.rows.map((row) => ({
        accountId: row.accountId,
        name: row.name || 'N/A',
      }));
      console.table(displayRows);
      console.log(
        `  ${COLORS.RED}⚠️  ${invalidSplitsResult.rows.length} project(s) with invalid splits${COLORS.NC}`,
      );
    }
    console.log('');

    // 5. Hidden Projects (Not Visible).
    console.log(`${COLORS.BLUE}=== Hidden Projects (Not Visible) ===${COLORS.NC}`);
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
      FROM ${schema}.projects
      WHERE is_visible = false
      ORDER BY created_at DESC
    `,
    );

    if (hiddenResult.rows.length === 0) {
      console.log(`  ${COLORS.GREEN}✓ No hidden projects${COLORS.NC}`);
    } else {
      const displayRows = hiddenResult.rows.map((row) => ({
        accountId: row.accountId,
        name: row.name || 'N/A',
      }));
      console.table(displayRows);
      console.log(
        `  ${COLORS.YELLOW}⚠️  ${hiddenResult.rows.length} hidden project(s)${COLORS.NC}`,
      );
    }
    console.log('');

    // 6. Summary.
    console.log(`${COLORS.BLUE}=== Summary ===${COLORS.NC}`);
    const validAndVisibleProjects = stats.validSplits && stats.visible ? stats.validSplits : 0;
    const validAndVisiblePercentage = ((validAndVisibleProjects / stats.total) * 100).toFixed(1);

    console.log(`  Total Projects: ${stats.total}`);
    console.log(
      `  Claimed: ${stats.claimed} (${((stats.claimed / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  Valid & Visible: ${COLORS.GREEN}${validAndVisibleProjects}${COLORS.NC} (${validAndVisiblePercentage}%)`,
    );

    if (stats.invalidSplits > 0) {
      console.log(
        `  ${COLORS.RED}⚠️  ${stats.invalidSplits} project(s) with invalid splits${COLORS.NC}`,
      );
    }
    if (stats.notVisible > 0) {
      console.log(`  ${COLORS.YELLOW}⚠️  ${stats.notVisible} project(s) not visible${COLORS.NC}`);
    }
  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
