import { config } from 'dotenv';
import { expand } from 'dotenv-expand';
import { Pool } from 'pg';

expand(config());

const COLORS = {
  RESET: '\x1b[0m',
  BRIGHT: '\x1b[1m',
  DIM: '\x1b[2m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  RED: '\x1b[31m',
};

type EventRow = {
  event_name: string;
  block_number: string;
  block_timestamp: Date;
  tx_index: number;
  log_index: number;
  transaction_hash: string;
  status: string;
  args: Record<string, unknown>;
};

type ProjectRow = {
  account_id: string;
  name: string;
  verification_status: string;
  owner_address: string | null;
  owner_account_id: string | null;
  claimed_at: Date | null;
  is_valid: boolean;
  is_visible: boolean;
  last_processed_ipfs_hash: string | null;
  created_at: Date;
  updated_at: Date;
};

async function visualizeProjectHistory(
  accountId: string,
  dbUrl: string,
  schema: string,
  excludeSplits: boolean = false,
): Promise<void> {
  const pool = new Pool({ connectionString: dbUrl });

  try {
    console.log(
      `${COLORS.BRIGHT}${COLORS.CYAN}╔════════════════════════════════════════════════════════════════╗${COLORS.RESET}`,
    );
    console.log(
      `${COLORS.BRIGHT}${COLORS.CYAN}║  Account Event History Visualizer                             ║${COLORS.RESET}`,
    );
    console.log(
      `${COLORS.BRIGHT}${COLORS.CYAN}╚════════════════════════════════════════════════════════════════╝${COLORS.RESET}`,
    );
    console.log();
    const timestamp = new Date().toISOString();
    console.log(`${COLORS.BRIGHT}Timestamp:${COLORS.RESET} ${timestamp}`);
    console.log(`${COLORS.BRIGHT}Database:${COLORS.RESET} ${dbUrl.replace(/:[^:@]+@/, ':***@')}`);
    console.log(`${COLORS.BRIGHT}Schema:${COLORS.RESET} ${schema}`);
    console.log(`${COLORS.BRIGHT}Account ID:${COLORS.RESET} ${accountId}`);
    if (excludeSplits) {
      console.log(
        `${COLORS.BRIGHT}Filter:${COLORS.RESET} ${COLORS.DIM}Excluding Split events${COLORS.RESET}`,
      );
    }
    console.log();

    // Try to find account in various tables
    let accountType: string | null = null;
    let accountData: any = null;

    // Check projects
    const projectResult = await pool.query(
      `SELECT 'project' as type, * FROM ${schema}.projects WHERE account_id = $1`,
      [accountId],
    );
    if (projectResult.rows.length > 0) {
      accountType = 'project';
      accountData = projectResult.rows[0];
    }

    // Check drip lists
    if (!accountType) {
      const dripListResult = await pool.query(
        `SELECT 'drip_list' as type, * FROM ${schema}.drip_lists WHERE account_id = $1`,
        [accountId],
      );
      if (dripListResult.rows.length > 0) {
        accountType = 'drip_list';
        accountData = dripListResult.rows[0];
      }
    }

    // Check ecosystem main accounts
    if (!accountType) {
      const ecosystemResult = await pool.query(
        `SELECT 'ecosystem' as type, * FROM ${schema}.ecosystem_main_accounts WHERE account_id = $1`,
        [accountId],
      );
      if (ecosystemResult.rows.length > 0) {
        accountType = 'ecosystem';
        accountData = ecosystemResult.rows[0];
      }
    }

    // Check linked identities
    if (!accountType) {
      const linkedIdentityResult = await pool.query(
        `SELECT 'linked_identity' as type, * FROM ${schema}.linked_identities WHERE account_id = $1`,
        [accountId],
      );
      if (linkedIdentityResult.rows.length > 0) {
        accountType = 'linked_identity';
        accountData = linkedIdentityResult.rows[0];
      }
    }

    // Display current state
    console.log(
      `${COLORS.BRIGHT}${COLORS.BLUE}┌─ Current State ────────────────────────────────────────────────┐${COLORS.RESET}`,
    );
    console.log(`${COLORS.BRIGHT}Account ID:${COLORS.RESET} ${accountId}`);

    if (accountType) {
      console.log(`${COLORS.BRIGHT}Account Type:${COLORS.RESET} ${accountType}`);

      // Display common fields
      if (accountData.name) {
        console.log(`${COLORS.BRIGHT}Name:${COLORS.RESET} ${accountData.name}`);
      }
      if (accountData.verification_status) {
        console.log(
          `${COLORS.BRIGHT}Verification Status:${COLORS.RESET} ${getStatusColor(accountData.verification_status)}${accountData.verification_status}${COLORS.RESET}`,
        );
      }
      if (accountData.owner_address !== undefined) {
        console.log(
          `${COLORS.BRIGHT}Owner Address:${COLORS.RESET} ${accountData.owner_address || `${COLORS.DIM}(null)${COLORS.RESET}`}`,
        );
      }
      if (accountData.owner_account_id !== undefined) {
        console.log(
          `${COLORS.BRIGHT}Owner Account ID:${COLORS.RESET} ${accountData.owner_account_id || `${COLORS.DIM}(null)${COLORS.RESET}`}`,
        );
      }
      if (accountData.claimed_at !== undefined) {
        console.log(
          `${COLORS.BRIGHT}Claimed At:${COLORS.RESET} ${accountData.claimed_at ? new Date(accountData.claimed_at).toISOString() : `${COLORS.DIM}(null)${COLORS.RESET}`}`,
        );
      }
      if (accountData.is_valid !== undefined) {
        console.log(`${COLORS.BRIGHT}Is Valid:${COLORS.RESET} ${accountData.is_valid ? '✓' : '✗'}`);
      }
      if (accountData.is_visible !== undefined) {
        console.log(`${COLORS.BRIGHT}Is Visible:${COLORS.RESET} ${accountData.is_visible ? '✓' : '✗'}`);
      }
      if (accountData.created_at) {
        console.log(`${COLORS.BRIGHT}Created At:${COLORS.RESET} ${new Date(accountData.created_at).toISOString()}`);
      }
      if (accountData.updated_at) {
        console.log(`${COLORS.BRIGHT}Updated At:${COLORS.RESET} ${new Date(accountData.updated_at).toISOString()}`);
      }
    } else {
      console.log(`${COLORS.YELLOW}⚠️  Account not found in projects, drip_lists, ecosystems, or linked_identities${COLORS.RESET}`);
      console.log(`${COLORS.DIM}Showing events only...${COLORS.RESET}`);
    }

    console.log(
      `${COLORS.BRIGHT}${COLORS.BLUE}└────────────────────────────────────────────────────────────────┘${COLORS.RESET}`,
    );
    console.log();

    // Get ALL event history where this account appears ANYWHERE in the args.
    // This includes: accountId, tokenId, receiver, sender, from, to, etc.
    let eventsQuery: string;
    if (excludeSplits) {
      eventsQuery = `
        SELECT
          event_name, block_number, block_timestamp,
          tx_index, log_index, transaction_hash, status, args,
          'actor' as role
        FROM ${schema}._events
        WHERE args::text LIKE $1
          AND event_name != 'Split'
        ORDER BY block_number, tx_index, log_index
      `;
    } else {
      eventsQuery = `
        SELECT
          event_name, block_number, block_timestamp,
          tx_index, log_index, transaction_hash, status, args,
          CASE
            WHEN event_name = 'Split' AND args->>'accountId' != $2 THEN 'received_split'
            ELSE 'actor'
          END as role
        FROM ${schema}._events
        WHERE args::text LIKE $1
        ORDER BY block_number, tx_index, log_index
      `;
    }

    const eventsResult = await pool.query<EventRow & { role: string }>(
      eventsQuery,
      excludeSplits ? [`%${accountId}%`] : [`%${accountId}%`, accountId]
    );

    if (eventsResult.rows.length === 0) {
      console.log(`${COLORS.YELLOW}No events found for this project${COLORS.RESET}`);
      return;
    }

    // Quick look timeline (vertical)
    console.log(
      `${COLORS.BRIGHT}${COLORS.BLUE}┌─ Quick Timeline ───────────────────────────────────────────────┐${COLORS.RESET}`,
    );
    eventsResult.rows.forEach((event, index) => {
      let name = event.event_name;
      let arrow = '';
      if (event.event_name === 'Split') {
        arrow = event.role === 'received_split' ? ' ←' : ' →';
        name = 'Split';
      }
      if (index > 0) {
        console.log('  ↓');
      }
      console.log(`  ${name}${arrow}`);
    });
    console.log(
      `${COLORS.BRIGHT}${COLORS.BLUE}└────────────────────────────────────────────────────────────────┘${COLORS.RESET}`,
    );
    console.log();

    console.log(
      `${COLORS.BRIGHT}${COLORS.MAGENTA}┌─ Event History (${eventsResult.rows.length} events) ──────────────────────────────────┐${COLORS.RESET}`,
    );
    console.log();

    // Group events by block/tx for better visualization.
    let currentBlock: string | null = null;
    let currentTx: number | null = null;

    for (const event of eventsResult.rows) {
      const isNewBlock = currentBlock !== event.block_number;
      const isNewTx = currentTx !== event.tx_index;

      if (isNewBlock) {
        if (currentBlock !== null) {
          console.log();
        }
        console.log(
          `${COLORS.DIM}═══════════════════════════════════════════════════════════════${COLORS.RESET}`,
        );
        console.log(
          `${COLORS.BRIGHT}Block ${event.block_number}${COLORS.RESET} ${COLORS.DIM}│${COLORS.RESET} ${event.block_timestamp.toISOString()}`,
        );
        console.log(
          `${COLORS.DIM}═══════════════════════════════════════════════════════════════${COLORS.RESET}`,
        );
        currentBlock = event.block_number;
        currentTx = null;
      }

      if (isNewTx) {
        console.log(
          `${COLORS.DIM}  ┌─ Tx ${event.tx_index} ${COLORS.RESET}${COLORS.DIM}│ ${event.transaction_hash}${COLORS.RESET}`,
        );
        currentTx = event.tx_index;
      }

      const statusBadge = getStatusBadge(event.status);
      const eventIcon = getEventIcon(event.event_name);
      const eventColor = getEventColor(event.event_name);

      let roleIndicator = '';
      if (event.event_name === 'Split') {
        roleIndicator =
          event.role === 'received_split'
            ? ` ${COLORS.GREEN}← RECEIVED${COLORS.RESET}`
            : ` ${COLORS.YELLOW}→ SENT${COLORS.RESET}`;
      }

      console.log(
        `${COLORS.DIM}  │${COLORS.RESET}   ${statusBadge} ${eventColor}${eventIcon} ${event.event_name}${COLORS.RESET}${roleIndicator} ${COLORS.DIM}[log ${event.log_index}]${COLORS.RESET}`,
      );

      // Display relevant args based on event type.
      const relevantArgs = getRelevantArgs(event.event_name, event.args);
      for (const [key, value] of Object.entries(relevantArgs)) {
        console.log(
          `${COLORS.DIM}  │${COLORS.RESET}      ${COLORS.DIM}${key}:${COLORS.RESET} ${formatArgValue(key, value)}`,
        );
      }
    }

    console.log();
    console.log(
      `${COLORS.BRIGHT}${COLORS.MAGENTA}└────────────────────────────────────────────────────────────────────┘${COLORS.RESET}`,
    );

    // Summary statistics
    console.log();
    console.log(
      `${COLORS.BRIGHT}${COLORS.CYAN}┌─ Summary ──────────────────────────────────────────────────────┐${COLORS.RESET}`,
    );
    console.log(`${COLORS.BRIGHT}Total Events:${COLORS.RESET} ${eventsResult.rows.length}`);

    const eventCounts = eventsResult.rows.reduce(
      (acc, event) => {
        const key =
          event.event_name === 'Split'
            ? event.role === 'received_split'
              ? 'Split (received)'
              : 'Split (sent)'
            : event.event_name;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    Object.entries(eventCounts)
      .sort(([, a], [, b]) => b - a)
      .forEach(([eventName, count]) => {
        console.log(`  ${eventName}: ${count}`);
      });

    const processedEvents = eventsResult.rows.filter((e) => e.status === 'processed').length;
    const failedEvents = eventsResult.rows.filter((e) => e.status === 'failed').length;
    const pendingEvents = eventsResult.rows.filter((e) => e.status === 'pending').length;

    console.log();
    console.log(`${COLORS.BRIGHT}Event Status:${COLORS.RESET}`);
    console.log(`  ${COLORS.GREEN}Processed:${COLORS.RESET} ${processedEvents}`);
    if (failedEvents > 0) {
      console.log(`  ${COLORS.RED}Failed:${COLORS.RESET} ${failedEvents}`);
    }
    if (pendingEvents > 0) {
      console.log(`  ${COLORS.YELLOW}Pending:${COLORS.RESET} ${pendingEvents}`);
    }

    if (eventsResult.rows.length > 0) {
      const firstEvent = eventsResult.rows[0]!;
      const lastEvent = eventsResult.rows[eventsResult.rows.length - 1]!;
      console.log();
      console.log(`${COLORS.BRIGHT}Time Range:${COLORS.RESET}`);
      console.log(
        `  First: Block ${firstEvent.block_number} (${firstEvent.block_timestamp.toISOString()})`,
      );
      console.log(
        `  Last:  Block ${lastEvent.block_number} (${lastEvent.block_timestamp.toISOString()})`,
      );
    }

    console.log(
      `${COLORS.BRIGHT}${COLORS.CYAN}└────────────────────────────────────────────────────────────────┘${COLORS.RESET}`,
    );
  } finally {
    await pool.end();
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'claimed':
      return COLORS.GREEN;
    case 'pending_metadata':
      return COLORS.YELLOW;
    case 'unclaimed':
      return COLORS.DIM;
    default:
      return '';
  }
}

function getStatusBadge(status: string): string {
  switch (status) {
    case 'processed':
      return `${COLORS.GREEN}✓${COLORS.RESET}`;
    case 'pending':
      return `${COLORS.YELLOW}⏳${COLORS.RESET}`;
    case 'failed':
      return `${COLORS.RED}✗${COLORS.RESET}`;
    default:
      return '?';
  }
}

function getEventIcon(eventName: string): string {
  switch (eventName) {
    case 'OwnerUpdateRequested':
      return '🔄';
    case 'OwnerUpdated':
      return '👤';
    case 'AccountMetadataEmitted':
      return '📝';
    case 'SplitsSet':
      return '💰';
    case 'Transfer':
      return '🔀';
    case 'Split':
      return '💸';
    default:
      return '📌';
  }
}

function getEventColor(eventName: string): string {
  switch (eventName) {
    case 'OwnerUpdateRequested':
      return COLORS.YELLOW;
    case 'OwnerUpdated':
      return COLORS.GREEN;
    case 'AccountMetadataEmitted':
      return COLORS.CYAN;
    case 'SplitsSet':
      return COLORS.MAGENTA;
    case 'Transfer':
      return COLORS.BLUE;
    default:
      return '';
  }
}

function getRelevantArgs(
  eventName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  switch (eventName) {
    case 'OwnerUpdateRequested':
      return {
        name: args.name,
        forge: args.forge,
        payer: args.payer,
      };
    case 'OwnerUpdated':
      return {
        owner: args.owner,
      };
    case 'AccountMetadataEmitted':
      return {
        key: args.key,
        value: args.value,
      };
    case 'SplitsSet':
      return {
        receiversHash: args.receiversHash,
      };
    case 'Transfer':
      return {
        from: args.from,
        to: args.to,
        tokenId: args.tokenId,
      };
    case 'Split':
      return {
        receiver: args.receiver,
        amt: args.amt,
        erc20: args.erc20,
      };
    default:
      return args;
  }
}

function formatArgValue(key: string, value: unknown): string {
  if (value === null || value === undefined) {
    return `${COLORS.DIM}(null)${COLORS.RESET}`;
  }

  if (typeof value === 'string') {
    // Decode hex strings if they look like encoded text.
    if (key === 'name' && value.startsWith('0x')) {
      try {
        const decoded = Buffer.from(value.slice(2), 'hex').toString('utf8');
        return `${value} ${COLORS.DIM}(${decoded})${COLORS.RESET}`;
      } catch {
        return value;
      }
    }

    if (key === 'key' && value.startsWith('0x')) {
      try {
        const decoded = Buffer.from(value.slice(2), 'hex').toString('utf8').replace(/\0/g, '');
        return `${COLORS.DIM}${decoded}${COLORS.RESET}`;
      } catch {
        return value;
      }
    }

    if (key === 'value' && value.startsWith('0x')) {
      try {
        const decoded = Buffer.from(value.slice(2), 'hex').toString('utf8');
        if (decoded.startsWith('Qm')) {
          return `${COLORS.CYAN}${decoded}${COLORS.RESET} ${COLORS.DIM}(IPFS)${COLORS.RESET}`;
        }
        return decoded;
      } catch {
        return value;
      }
    }

    // Truncate long addresses.
    if (value.startsWith('0x') && value.length === 42) {
      return `${value.slice(0, 6)}...${value.slice(-4)}`;
    }

    // Truncate very long strings.
    if (value.length > 80) {
      return `${value.slice(0, 40)}...${value.slice(-40)}`;
    }

    return value;
  }

  return String(value);
}

// Main execution.
const args = process.argv.slice(2);
const accountId = args[0];
const nonFlagArgs = args.filter((arg) => !arg.startsWith('--'));
const dbUrl = nonFlagArgs[1] || process.env.DATABASE_URL;
const schema = nonFlagArgs[2] || process.env.NETWORK || 'public';
const excludeSplits = args.includes('--no-splits');

if (!accountId) {
  console.error(
    `${COLORS.RED}Usage: tsx scripts/project-event-history.ts <account_id> [db_url] [schema] [--no-splits]${COLORS.RESET}`,
  );
  console.error();
  console.error(`${COLORS.BRIGHT}Examples:${COLORS.RESET}`);
  console.error(
    `  tsx scripts/project-event-history.ts 80907569960768687250556748374323960980154517009420974372180056866816`,
  );
  console.error(
    `  tsx scripts/project-event-history.ts 80907569960768687250556748374323960980154517009420974372180056866816 "postgresql://user:pass@host:5432/db"`,
  );
  console.error(
    `  tsx scripts/project-event-history.ts 80907569960768687250556748374323960980154517009420974372180056866816 "postgresql://user:pass@host:5432/db" filecoin`,
  );
  console.error(
    `  tsx scripts/project-event-history.ts 80907569960768687250556748374323960980154517009420974372180056866816 "postgresql://user:pass@host:5432/db" filecoin --no-splits`,
  );
  console.error();
  console.error(`${COLORS.BRIGHT}Environment Variables:${COLORS.RESET}`);
  console.error(`  DATABASE_URL     - Database connection string (default: from .env)`);
  console.error(`  NETWORK          - Schema to query (default: public)`);
  process.exit(1);
}

if (!dbUrl) {
  console.error(
    `${COLORS.RED}Error: DATABASE_URL environment variable is not set and no db_url argument provided${COLORS.RESET}`,
  );
  console.error();
  console.error(`${COLORS.BRIGHT}Either:${COLORS.RESET}`);
  console.error(`  1. Set DATABASE_URL environment variable in .env`);
  console.error(`  2. Pass db_url as second argument`);
  process.exit(1);
}

visualizeProjectHistory(accountId, dbUrl, schema, excludeSplits).catch((error: Error) => {
  console.error(`${COLORS.RED}Error:${COLORS.RESET}`, error.message);
  process.exit(1);
});
