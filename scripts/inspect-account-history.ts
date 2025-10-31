import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';
import { Pool, types } from 'pg';

import { loadChainConfig } from '../src/chains/loadChainConfig.js';
import { validateSchemaName } from '../src/utils/sqlValidation.js';

import { configureScriptLogger } from './shared/configure-logger.js';

// Configure logger for debug output.
configureScriptLogger();

interface VisualizeOptions {
  accountId: string;
  dbUrl: string;
  schema: string;
  network: string;
  excludeSplits: boolean;
}

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

async function visualizeProjectHistory(options: VisualizeOptions): Promise<void> {
  const { accountId, dbUrl, schema, network, excludeSplits } = options;

  // Load chain config from network name.
  const chainConfig = loadChainConfig(network);
  const chainId = String(chainConfig.chainId);

  // Display header.
  console.log(
    boxen(chalk.bold.cyan('📊 ACCOUNT EVENT HISTORY VISUALIZER 📊'), {
      padding: 1,
      borderColor: 'cyan',
      borderStyle: 'double',
    }),
  );
  console.log();

  console.log(
    chalk.cyan('Visualize the complete event history for any account across all event types.'),
  );
  console.log();

  // Display connection info.
  console.log(
    boxen(chalk.bold('Database Connection & Query Information'), {
      padding: 1,
      borderColor: 'blue',
      borderStyle: 'round',
    }),
  );
  console.log();

  const infoTable = new Table({
    colWidths: [25, 80],
    wordWrap: true,
    style: { head: [] },
  });

  infoTable.push(
    [chalk.cyan('Database URL'), dbUrl],
    [chalk.cyan('Schema'), chalk.bold(schema)],
    [chalk.cyan('Network'), chalk.bold(network)],
    [chalk.cyan('Chain ID'), chalk.bold(chainId)],
    [chalk.cyan('Account ID'), chalk.bold(accountId)],
  );

  if (excludeSplits) {
    infoTable.push([chalk.cyan('Filter'), chalk.dim('Excluding Split events')]);
  }

  console.log(infoTable.toString());
  console.log();

  // Configure pg types.
  types.setTypeParser(types.builtins.INT8, (val: string) => BigInt(val));

  const pool = new Pool({
    connectionString: dbUrl,
  });

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

    // Try to find account in various tables.
    let accountType: string | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let accountData: any = null;

    // Check projects.
    const projectResult = await pool.query(
      `SELECT 'project' as type, * FROM ${validatedSchema}.projects WHERE account_id = $1`,
      [accountId],
    );
    if (projectResult.rows.length > 0) {
      accountType = 'project';
      accountData = projectResult.rows[0];
    }

    // Check drip lists.
    if (!accountType) {
      const dripListResult = await pool.query(
        `SELECT 'drip_list' as type, * FROM ${validatedSchema}.drip_lists WHERE account_id = $1`,
        [accountId],
      );
      if (dripListResult.rows.length > 0) {
        accountType = 'drip_list';
        accountData = dripListResult.rows[0];
      }
    }

    // Check ecosystem main accounts.
    if (!accountType) {
      const ecosystemResult = await pool.query(
        `SELECT 'ecosystem' as type, * FROM ${validatedSchema}.ecosystem_main_accounts WHERE account_id = $1`,
        [accountId],
      );
      if (ecosystemResult.rows.length > 0) {
        accountType = 'ecosystem';
        accountData = ecosystemResult.rows[0];
      }
    }

    // Check linked identities.
    if (!accountType) {
      const linkedIdentityResult = await pool.query(
        `SELECT 'linked_identity' as type, * FROM ${validatedSchema}.linked_identities WHERE account_id = $1`,
        [accountId],
      );
      if (linkedIdentityResult.rows.length > 0) {
        accountType = 'linked_identity';
        accountData = linkedIdentityResult.rows[0];
      }
    }

    // Display current state.
    console.log(
      boxen(chalk.bold('Current Account State'), {
        padding: 1,
        borderColor: 'blue',
        borderStyle: 'round',
      }),
    );
    console.log();

    const stateTable = new Table({
      colWidths: [25, 80],
      wordWrap: true,
      style: { head: [] },
    });

    stateTable.push([chalk.cyan('Account ID'), accountId]);

    if (accountType) {
      stateTable.push([chalk.cyan('Account Type'), chalk.bold(accountType)]);

      // Display common fields.
      if (accountData.name) {
        stateTable.push([chalk.cyan('Name'), accountData.name]);
      }
      if (accountData.verification_status) {
        const statusColor = getStatusColor(accountData.verification_status);
        stateTable.push([
          chalk.cyan('Verification Status'),
          `${statusColor}${accountData.verification_status}${chalk.reset('')}`,
        ]);
      }
      if (accountData.owner_address !== undefined) {
        stateTable.push([
          chalk.cyan('Owner Address'),
          accountData.owner_address || chalk.dim('(null)'),
        ]);
      }
      if (accountData.owner_account_id !== undefined) {
        stateTable.push([
          chalk.cyan('Owner Account ID'),
          accountData.owner_account_id || chalk.dim('(null)'),
        ]);
      }
      if (accountData.claimed_at !== undefined) {
        stateTable.push([
          chalk.cyan('Claimed At'),
          accountData.claimed_at
            ? new Date(accountData.claimed_at).toISOString()
            : chalk.dim('(null)'),
        ]);
      }
      if (accountData.is_valid !== undefined) {
        stateTable.push([
          chalk.cyan('Is Valid'),
          accountData.is_valid ? chalk.green('✓ Yes') : chalk.red('✗ No'),
        ]);
      }
      if (accountData.is_visible !== undefined) {
        stateTable.push([
          chalk.cyan('Is Visible'),
          accountData.is_visible ? chalk.green('✓ Yes') : chalk.red('✗ No'),
        ]);
      }
      if (accountData.created_at) {
        stateTable.push([chalk.cyan('Created At'), new Date(accountData.created_at).toISOString()]);
      }
      if (accountData.updated_at) {
        stateTable.push([chalk.cyan('Updated At'), new Date(accountData.updated_at).toISOString()]);
      }

      console.log(stateTable.toString());
    } else {
      console.log(
        chalk.yellow(
          '⚠️  Account not found in projects, drip_lists, ecosystems, or linked_identities',
        ),
      );
      console.log(chalk.dim('Showing events only...'));
    }

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
        FROM ${validatedSchema}._events
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
        FROM ${validatedSchema}._events
        WHERE args::text LIKE $1
        ORDER BY block_number, tx_index, log_index
      `;
    }

    const eventsResult = await pool.query<EventRow & { role: string }>(
      eventsQuery,
      excludeSplits ? [`%${accountId}%`] : [`%${accountId}%`, accountId],
    );

    if (eventsResult.rows.length === 0) {
      console.log(chalk.yellow('No events found for this account'));
      return;
    }

    // Quick look timeline (vertical).
    console.log(
      boxen(
        chalk.bold(
          `Quick Timeline (${eventsResult.rows.length} event${eventsResult.rows.length !== 1 ? 's' : ''})`,
        ),
        {
          padding: 1,
          borderColor: 'blue',
          borderStyle: 'round',
        },
      ),
    );
    console.log();

    eventsResult.rows.forEach((event, index) => {
      const eventIcon = getEventIcon(event.event_name);
      const eventColor = getEventColor(event.event_name);
      let name = event.event_name;
      let arrow = '';

      if (event.event_name === 'Split') {
        arrow = event.role === 'received_split' ? chalk.green(' ←') : chalk.yellow(' →');
        name = 'Split';
      }

      if (index > 0) {
        console.log(chalk.dim('  ↓'));
      }

      console.log(`  ${eventColor}${eventIcon} ${name}${chalk.reset('')}${arrow}`);
    });

    console.log();

    console.log(
      boxen(chalk.bold.magenta(`Detailed Event History (${eventsResult.rows.length} events)`), {
        padding: 1,
        borderColor: 'magenta',
        borderStyle: 'round',
      }),
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
        console.log(chalk.dim('═'.repeat(65)));
        console.log(
          `${chalk.bold(`Block ${event.block_number}`)} ${chalk.dim('│')} ${event.block_timestamp.toISOString()}`,
        );
        console.log(chalk.dim('═'.repeat(65)));
        currentBlock = event.block_number;
        currentTx = null;
      }

      if (isNewTx) {
        console.log(
          `${chalk.dim(`  ┌─ Tx ${event.tx_index} │`)} ${chalk.dim(event.transaction_hash)}`,
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
            ? ` ${chalk.green('← RECEIVED')}`
            : ` ${chalk.yellow('→ SENT')}`;
      }

      console.log(
        `${chalk.dim('  │')}   ${statusBadge} ${eventColor}${eventIcon} ${event.event_name}${chalk.reset('')}${roleIndicator} ${chalk.dim(`[log ${event.log_index}]`)}`,
      );

      // Display relevant args based on event type.
      const relevantArgs = getRelevantArgs(event.event_name, event.args);
      for (const [key, value] of Object.entries(relevantArgs)) {
        console.log(
          `${chalk.dim('  │')}      ${chalk.dim(`${key}:`)} ${formatArgValue(key, value)}`,
        );
      }
    }

    console.log();

    // Summary statistics.
    console.log(
      boxen(chalk.bold('Summary Statistics'), {
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

    summaryTable.push([
      chalk.bold('Total Events'),
      chalk.bold(eventsResult.rows.length.toString()),
    ]);

    console.log(summaryTable.toString());
    console.log();

    // Event type breakdown.
    console.log(chalk.bold('Event Type Breakdown:'));
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
        console.log(`  ${eventName}: ${chalk.bold(count.toString())}`);
      });

    console.log();

    // Status breakdown.
    const processedEvents = eventsResult.rows.filter((e) => e.status === 'processed').length;
    const failedEvents = eventsResult.rows.filter((e) => e.status === 'failed').length;
    const pendingEvents = eventsResult.rows.filter((e) => e.status === 'pending').length;

    console.log(chalk.bold('Event Status:'));
    console.log(`  ${chalk.green('Processed:')} ${processedEvents}`);
    if (failedEvents > 0) {
      console.log(`  ${chalk.red('Failed:')} ${failedEvents}`);
    }
    if (pendingEvents > 0) {
      console.log(`  ${chalk.yellow('Pending:')} ${pendingEvents}`);
    }

    // Time range.
    if (eventsResult.rows.length > 0) {
      const firstEvent = eventsResult.rows[0]!;
      const lastEvent = eventsResult.rows[eventsResult.rows.length - 1]!;
      console.log();
      console.log(chalk.bold('Time Range:'));
      console.log(
        `  First: Block ${firstEvent.block_number} (${firstEvent.block_timestamp.toISOString()})`,
      );
      console.log(
        `  Last:  Block ${lastEvent.block_number} (${lastEvent.block_timestamp.toISOString()})`,
      );
    }

    console.log();
  } catch (error) {
    console.log();
    console.log(
      boxen(chalk.bold.red('✗ Account history visualization failed!'), {
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

function getStatusColor(status: string): string {
  switch (status) {
    case 'claimed':
      return chalk.green('');
    case 'pending_metadata':
      return chalk.yellow('');
    case 'unclaimed':
      return chalk.dim('');
    default:
      return '';
  }
}

function getStatusBadge(status: string): string {
  switch (status) {
    case 'processed':
      return chalk.green('✓');
    case 'pending':
      return chalk.yellow('⏳');
    case 'failed':
      return chalk.red('✗');
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
      return chalk.yellow('');
    case 'OwnerUpdated':
      return chalk.green('');
    case 'AccountMetadataEmitted':
      return chalk.cyan('');
    case 'SplitsSet':
      return chalk.magenta('');
    case 'Transfer':
      return chalk.blue('');
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
    return chalk.dim('(null)');
  }

  if (typeof value === 'string') {
    // Decode hex strings if they look like encoded text.
    if (key === 'name' && value.startsWith('0x')) {
      try {
        const decoded = Buffer.from(value.slice(2), 'hex').toString('utf8');
        return `${value} ${chalk.dim(`(${decoded})`)}`;
      } catch {
        return value;
      }
    }

    if (key === 'key' && value.startsWith('0x')) {
      try {
        const decoded = Buffer.from(value.slice(2), 'hex').toString('utf8').replace(/\0/g, '');
        return chalk.dim(decoded);
      } catch {
        return value;
      }
    }

    if (key === 'value' && value.startsWith('0x')) {
      try {
        const decoded = Buffer.from(value.slice(2), 'hex').toString('utf8');
        if (decoded.startsWith('Qm')) {
          return `${chalk.cyan(decoded)} ${chalk.dim('(IPFS)')}`;
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

// CLI setup.
const program = new Command();

program
  .name('info:account-history')
  .description('Visualize the complete event history for any account across all event types')
  .requiredOption('--account-id <id>', 'Account ID to visualize')
  .requiredOption('--db-url <url>', 'Database connection URL')
  .requiredOption('--schema <name>', 'Database schema name')
  .requiredOption('--network <name>', 'Network name (e.g., optimism, mainnet)')
  .option('--exclude-splits', 'Exclude Split events from the visualization', false)
  .action((options) => {
    visualizeProjectHistory({
      accountId: options.accountId,
      dbUrl: options.dbUrl,
      schema: options.schema,
      network: options.network,
      excludeSplits: options.excludeSplits,
    });
  });

program.parse();
