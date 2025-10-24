import { Pool, types } from 'pg';

import { config } from '../src/config.js';
import { loadChainConfig } from '../src/chains/loadChainConfig.js';
import { validateSchemaName } from '../src/utils/sqlValidation.js';

const COLORS = {
  RED: '\x1b[0;31m',
  YELLOW: '\x1b[1;33m',
  GREEN: '\x1b[0;32m',
  BLUE: '\x1b[0;34m',
  BOLD: '\x1b[1m',
  NC: '\x1b[0m',
};

interface Args {
  schema: string;
  chainId: string;
  block: bigint;
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

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let schema: string | undefined;
  let chainId: string | undefined;
  let block: bigint | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--schema' && args[i + 1]) {
      schema = args[i + 1];
      i++;
    } else if (args[i] === '--chain' && args[i + 1]) {
      chainId = args[i + 1];
      i++;
    } else if (args[i] === '--block' && args[i + 1]) {
      block = BigInt(args[i + 1]!);
      i++;
    }
  }

  // Use config defaults if not specified.
  // Load chain config to get chainId like main.ts does.
  const chainConfig = loadChainConfig(config.network);
  schema = schema || config.database.schema;
  chainId = chainId || String(chainConfig.chainId);

  if (!schema || !chainId || block === undefined) {
    console.log(`${COLORS.RED}Error: Missing required argument --block${COLORS.NC}`);
    console.log('');
    console.log('Usage:');
    console.log(
      '  npm run inspect-orphans -- --block <blockNumber> [--schema <schema>] [--chain <chainId>]',
    );
    console.log('');
    console.log('Description:');
    console.log(
      '  Scans domain tables for orphaned records created from the specified block onwards.',
    );
    console.log(
      '  Orphaned records are entities without corresponding events (e.g., after a reorg or rollback).',
    );
    console.log('');
    console.log('Arguments:');
    console.log(
      '  --block      Required: Block number to inspect from (scans records created after this block)',
    );
    console.log('  --schema     Optional: Database schema (default: from .env DB_SCHEMA)');
    console.log('  --chain      Optional: Chain ID (default: from .env NETWORK config)');
    console.log('');
    console.log('Examples:');
    console.log(
      '  npm run inspect-orphans -- --block 19500000                              # Using .env config',
    );
    console.log(
      '  npm run inspect-orphans -- --block 19500000 --schema sepolia --chain 11155111  # Override schema/chain',
    );
    console.log('');
    console.log('Typical workflow:');
    console.log('  1. Run rollback:   npm run rollback -- --block 19500000');
    console.log('  2. Inspect orphans: npm run inspect-orphans -- --block 19500000');
    console.log('  3. Restart indexer to re-process from block 19500000');
    process.exit(1);
  }

  return { schema, chainId, block: block as bigint };
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

  console.log(`${COLORS.BLUE}Scanning domain tables for orphaned records...${COLORS.NC}`);
  console.log('');

  for (const table of domainTables) {
    console.log(`  Checking ${COLORS.YELLOW}${table.name}${COLORS.NC}...`);

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

async function main(): Promise<void> {
  const args = parseArgs();

  console.log(
    `${COLORS.BOLD}${COLORS.BLUE}╔═══════════════════════════════════════════════════════════════════╗${COLORS.NC}`,
  );
  console.log(
    `${COLORS.BOLD}${COLORS.BLUE}║                 🔍 ORPHAN INSPECTION SCRIPT 🔍                    ║${COLORS.NC}`,
  );
  console.log(
    `${COLORS.BOLD}${COLORS.BLUE}╚═══════════════════════════════════════════════════════════════════╝${COLORS.NC}`,
  );
  console.log('');

  console.log(`${COLORS.BLUE}This script identifies orphaned domain entities.${COLORS.NC}`);
  console.log(
    `${COLORS.BLUE}Orphaned records are entities without corresponding events (reorgs, bugs, etc).${COLORS.NC}`,
  );
  console.log('');

  console.log(`Schema: ${COLORS.YELLOW}${args.schema}${COLORS.NC}`);
  console.log(`Chain ID: ${COLORS.YELLOW}${args.chainId}${COLORS.NC}`);
  console.log(`Inspecting from block: ${COLORS.YELLOW}${args.block.toString()}${COLORS.NC}`);
  console.log('');

  // Configure pg types.
  types.setTypeParser(types.builtins.INT8, (val: string) => BigInt(val));

  const pool = new Pool({
    connectionString: config.database.url,
  });

  try {
    const schema = validateSchemaName(args.schema);

    // Check database connection.
    await pool.query('SELECT 1');

    // Check if cursor exists.
    const cursorResult = await pool.query<{ fetched_to_block: string }>(
      `SELECT fetched_to_block FROM ${schema}._cursor WHERE chain_id = $1`,
      [args.chainId],
    );

    if (cursorResult.rows.length === 0) {
      console.log(`${COLORS.RED}Error: No cursor found for chain ${args.chainId}${COLORS.NC}`);
      process.exit(1);
    }

    const currentCursor = BigInt(cursorResult.rows[0]!.fetched_to_block);
    console.log(`${COLORS.BLUE}Current cursor position: ${currentCursor.toString()}${COLORS.NC}`);
    console.log('');

    // Discover domain tables from database schema.
    const domainTables = await discoverDomainTables(pool, schema);
    console.log(
      `${COLORS.GREEN}✓ Discovered ${domainTables.length} domain tables from schema${COLORS.NC}`,
    );
    console.log('');

    // Inspect orphans.
    const results = await inspectOrphans(pool, schema, args.chainId, args.block, domainTables);

    // Display results.
    console.log('');
    console.log(`${COLORS.BOLD}${COLORS.BLUE}=== INSPECTION RESULTS ===${COLORS.NC}`);
    console.log('');

    let totalOrphans = 0;
    const tablesWithOrphans: string[] = [];

    for (const result of results) {
      const orphanCount = result.orphanedRecords.length;
      totalOrphans += orphanCount;

      if (orphanCount > 0) {
        tablesWithOrphans.push(result.tableName);
        console.log(
          `${COLORS.YELLOW}${result.tableName}${COLORS.NC}: ${COLORS.RED}${orphanCount} potential orphan(s)${COLORS.NC}`,
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
        console.log('');
      } else {
        console.log(`${COLORS.GREEN}${result.tableName}${COLORS.NC}: No orphans detected`);
      }
    }

    console.log('');
    console.log(`${COLORS.BOLD}${COLORS.BLUE}=== SUMMARY ===${COLORS.NC}`);
    console.log('');

    if (totalOrphans === 0) {
      console.log(`${COLORS.GREEN}✓ No orphaned records detected!${COLORS.NC}`);
      console.log('');
      console.log('The database appears consistent with the current chain state.');
    } else {
      console.log(
        `${COLORS.YELLOW}⚠️  Found ${totalOrphans} potential orphaned record(s) across ${tablesWithOrphans.length} table(s)${COLORS.NC}`,
      );
      console.log('');
      console.log('Affected tables:');
      for (const table of tablesWithOrphans) {
        console.log(`  - ${table}`);
      }
      console.log('');
      console.log(`${COLORS.YELLOW}${COLORS.BOLD}IMPORTANT:${COLORS.NC}`);
      console.log(
        '  This script uses heuristics and may report false positives, especially without --block.',
      );
      console.log('  Orphaned records should be manually reviewed before deletion.');
      console.log('');
      console.log(`${COLORS.BLUE}Recommended Actions:${COLORS.NC}`);
      console.log('  1. Review the listed records and verify they are actually orphaned');
      console.log(
        '  2. Check if corresponding events exist in _events table that created these records',
      );
      console.log('  3. If confirmed orphaned, consider manual cleanup or re-running recovery');
      console.log(
        '  4. For future reorgs, ensure AUTO_HANDLE_REORGS is enabled or manual recovery is run promptly',
      );
    }

    console.log('');
  } catch (error) {
    console.log('');
    console.log(`${COLORS.RED}${COLORS.BOLD}✗ Orphan inspection failed!${COLORS.NC}`);
    console.log('');
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
