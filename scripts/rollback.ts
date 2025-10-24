import * as readline from 'readline';

import { Pool, types } from 'pg';
import { createPublicClient, http, type Chain } from 'viem';

import { config } from '../src/config.js';
import { loadChainConfig } from '../src/chains/loadChainConfig.js';
import { RpcClient } from '../src/core/RpcClient.js';
import { ReorgDetector } from '../src/core/ReorgDetector.js';
import { CursorRepository } from '../src/repositories/CursorRepository.js';
import { EventRepository } from '../src/repositories/EventsRepository.js';
import { BlockHashesRepository } from '../src/repositories/BlockHashesRepository.js';
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
    console.log('  npm run rollback -- --block <blockNumber> [--schema <schema>] [--chain <chainId>]');
    console.log('');
    console.log('Description:');
    console.log('  Rolls back the indexer state to a specific block by deleting all events,');
    console.log('  block hashes, and resetting the cursor. Useful for reorg recovery or debugging.');
    console.log('');
    console.log('Arguments:');
    console.log('  --block      Required: Block number to roll back to (data from this block onwards will be deleted)');
    console.log('  --schema     Optional: Database schema (default: from .env DB_SCHEMA)');
    console.log('  --chain      Optional: Chain ID (default: from .env NETWORK config)');
    console.log('');
    console.log('Examples:');
    console.log('  npm run rollback -- --block 19500000                                    # Rollback using .env config');
    console.log('  npm run rollback -- --block 19500000 --schema ethereum_mainnet --chain 1  # Override schema/chain');
    process.exit(1);
  }

  return { schema, chainId, block: block as bigint };
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs();

  console.log(`${COLORS.BOLD}${COLORS.RED}╔═══════════════════════════════════════════════════════════════════╗${COLORS.NC}`);
  console.log(`${COLORS.BOLD}${COLORS.RED}║                     🔄 ROLLBACK SCRIPT 🔄                         ║${COLORS.NC}`);
  console.log(`${COLORS.BOLD}${COLORS.RED}╚═══════════════════════════════════════════════════════════════════╝${COLORS.NC}`);
  console.log('');

  console.log(`${COLORS.YELLOW}${COLORS.BOLD}⚠️  WARNING: This operation is DESTRUCTIVE and IRREVERSIBLE! ⚠️${COLORS.NC}`);
  console.log('');
  console.log('This script will:');
  console.log(`  ${COLORS.RED}1. DELETE all events from block ${args.block} onwards${COLORS.NC}`);
  console.log(`  ${COLORS.RED}2. DELETE all block hashes from block ${args.block} onwards${COLORS.NC}`);
  console.log(`  ${COLORS.RED}3. RESET cursor to block ${args.block - 1n}${COLORS.NC}`);
  console.log('');
  console.log(`Schema: ${COLORS.BLUE}${args.schema}${COLORS.NC}`);
  console.log(`Chain ID: ${COLORS.BLUE}${args.chainId}${COLORS.NC}`);
  console.log(`Reorg Block: ${COLORS.BLUE}${args.block.toString()}${COLORS.NC}`);
  console.log('');

  // Check if indexer is running.
  console.log(`${COLORS.YELLOW}${COLORS.BOLD}BEFORE PROCEEDING:${COLORS.NC}`);
  console.log(`  ${COLORS.YELLOW}1. Ensure the indexer is STOPPED${COLORS.NC}`);
  console.log(`  ${COLORS.YELLOW}2. Ensure no other processes are accessing the database${COLORS.NC}`);
  console.log(`  ${COLORS.YELLOW}3. Verify the reorg block number is correct${COLORS.NC}`);
  console.log('');

  const confirm1 = await prompt(
    `${COLORS.BOLD}Have you STOPPED the indexer? (yes/no): ${COLORS.NC}`,
  );
  if (confirm1.toLowerCase() !== 'yes') {
    console.log(`${COLORS.RED}Aborting. Please stop the indexer first.${COLORS.NC}`);
    process.exit(1);
  }

  const confirm2 = await prompt(
    `${COLORS.BOLD}Are you ABSOLUTELY SURE you want to delete data from block ${args.block} onwards? Type 'DELETE' to confirm: ${COLORS.NC}`,
  );
  if (confirm2 !== 'DELETE') {
    console.log(`${COLORS.RED}Aborting. Confirmation not received.${COLORS.NC}`);
    process.exit(1);
  }

  console.log('');
  console.log(`${COLORS.BLUE}Starting reorg recovery...${COLORS.NC}`);
  console.log('');

  // Configure pg types.
  types.setTypeParser(types.builtins.INT8, (val: string) => BigInt(val));

  const pool = new Pool({
    connectionString: config.database.url,
  });

  try {
    const schema = validateSchemaName(args.schema);
    const chainId = args.chainId;

    // Create RPC client.
    const client = createPublicClient({
      chain: { id: parseInt(chainId, 10) } as Chain,
      transport: http(config.chain.rpcUrl, {
        timeout: 30000,
      }),
    });

    const rpc = new RpcClient(client, {
      chainId: parseInt(chainId, 10),
      concurrency: 1,
    });

    // Initialize repositories.
    const cursorRepo = new CursorRepository(schema, chainId);
    const eventsRepo = new EventRepository(schema, chainId);
    const blockHashesRepo = new BlockHashesRepository(pool, schema);

    // Create ReorgDetector.
    const reorgDetector = new ReorgDetector(
      pool,
      schema,
      chainId,
      rpc,
      BigInt(config.chain.startBlock || 0),
      config.chain.confirmations,
      false,
      cursorRepo,
      eventsRepo,
      blockHashesRepo,
    );

    // Check current cursor state.
    const cursor = await cursorRepo.getCursor(pool);
    if (!cursor) {
      console.log(`${COLORS.RED}Error: Cursor not found for chain ${chainId}${COLORS.NC}`);
      process.exit(1);
    }

    console.log(`${COLORS.BLUE}Current cursor position: ${cursor.fetchedToBlock.toString()}${COLORS.NC}`);
    console.log(
      `${COLORS.BLUE}Target cursor position after recovery: ${(args.block - 1n).toString()}${COLORS.NC}`,
    );

    if (args.block > cursor.fetchedToBlock) {
      console.log('');
      console.log(
        `${COLORS.YELLOW}Warning: Reorg block (${args.block}) is ahead of current cursor (${cursor.fetchedToBlock})${COLORS.NC}`,
      );
      console.log(
        `${COLORS.YELLOW}This is unusual but may be valid if cursor was manually reset.${COLORS.NC}`,
      );
      console.log('');

      const confirmAhead = await prompt(
        `${COLORS.BOLD}Continue anyway? (yes/no): ${COLORS.NC}`,
      );
      if (confirmAhead.toLowerCase() !== 'yes') {
        console.log(`${COLORS.RED}Aborting.${COLORS.NC}`);
        process.exit(1);
      }
    }

    // Get count of events to be deleted.
    const client2 = await pool.connect();
    try {
      const eventsCountResult = await client2.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM ${schema}._events WHERE chain_id = $1 AND block_number >= $2`,
        [chainId, args.block.toString()],
      );
      const eventsToDelete = BigInt(eventsCountResult.rows[0]?.count || '0');

      const hashesCountResult = await client2.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM ${schema}._block_hashes WHERE chain_id = $1 AND block_number >= $2`,
        [chainId, args.block.toString()],
      );
      const hashesToDelete = BigInt(hashesCountResult.rows[0]?.count || '0');

      console.log('');
      console.log(`${COLORS.YELLOW}Data to be deleted:${COLORS.NC}`);
      console.log(`  ${COLORS.RED}Events: ${eventsToDelete.toString()}${COLORS.NC}`);
      console.log(`  ${COLORS.RED}Block hashes: ${hashesToDelete.toString()}${COLORS.NC}`);
      console.log('');

      if (eventsToDelete === 0n && hashesToDelete === 0n) {
        console.log(
          `${COLORS.YELLOW}Warning: No data found to delete. Recovery may be unnecessary.${COLORS.NC}`,
        );
        const confirmEmpty = await prompt(
          `${COLORS.BOLD}Continue anyway? (yes/no): ${COLORS.NC}`,
        );
        if (confirmEmpty.toLowerCase() !== 'yes') {
          console.log(`${COLORS.RED}Aborting.${COLORS.NC}`);
          process.exit(1);
        }
      }
    } finally {
      client2.release();
    }

    console.log('');
    console.log(`${COLORS.BLUE}Executing rollback...${COLORS.NC}`);

    // Execute handleReorg.
    await reorgDetector.handleReorg(args.block);

    console.log('');
    console.log(`${COLORS.GREEN}${COLORS.BOLD}✓ Rollback completed successfully!${COLORS.NC}`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Verify cursor position in database');
    console.log('  2. Run orphan inspection script to check for orphaned domain entities:');
    console.log(`     ${COLORS.BLUE}npm run inspect-orphans -- --block ${args.block}${COLORS.NC}`);
    console.log('  3. Restart the indexer to resume from the rolled-back cursor position');
    console.log('');
  } catch (error) {
    console.log('');
    console.log(`${COLORS.RED}${COLORS.BOLD}✗ Rollback failed!${COLORS.NC}`);
    console.log('');
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
