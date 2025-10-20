import { Pool, types } from 'pg';

import { config } from '../src/config.js';
import { loadChainConfig } from '../src/chain-configs/loadChainConfig.js';
import { RpcClient } from '../src/core/RpcClient.js';
import { ReorgDetector } from '../src/core/ReorgDetector.js';
import { CursorRepository } from '../src/repositories/CursorRepository.js';
import { EventRepository } from '../src/repositories/EventsRepository.js';
import { BlockHashesRepository } from '../src/repositories/BlockHashesRepository.js';
import { createPublicClient, http, type Chain } from 'viem';

types.setTypeParser(types.builtins.INT8, (val: string) => BigInt(val));

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: config.database.url });
  const chainConfig = loadChainConfig(config.network);
  const schema = config.database.schema;
  const chainId = String(chainConfig.chainId);

  try {
    // Get current cursor
    console.log('\n=== STEP 1: Get current cursor ===');
    const cursorRepo = new CursorRepository(schema, chainId);
    const cursor = await cursorRepo.getCursor(pool);
    if (!cursor) {
      throw new Error('No cursor found');
    }
    console.log('Current cursor:', cursor.fetchedToBlock.toString());

    // Rollback 1000 blocks
    const rollbackBlock = cursor.fetchedToBlock - 1000n;
    console.log('Rollback to block:', rollbackBlock.toString());

    // Count events before
    console.log('\n=== STEP 2: Count events before rollback ===');
    const eventsRepo = new EventRepository(schema, chainId);
    const eventsBefore = await pool.query(
      `SELECT COUNT(*) as count FROM ${schema}._events WHERE chain_id = $1 AND block_number >= $2`,
      [chainId, rollbackBlock.toString()],
    );
    console.log('Events >= rollback block:', eventsBefore.rows[0]?.count);

    // Execute rollback
    console.log('\n=== STEP 3: Execute rollback ===');
    const client = createPublicClient({
      chain: { id: parseInt(chainId, 10) } as Chain,
      transport: http(config.chain.rpcUrl, { timeout: 30000 }),
    });
    const rpc = new RpcClient(client, { chainId: parseInt(chainId, 10), concurrency: 1 });
    const blockHashesRepo = new BlockHashesRepository(pool, schema);
    const reorgDetector = new ReorgDetector(
      pool,
      schema,
      chainId,
      rpc,
      BigInt(chainConfig.startBlock),
      config.chain.confirmations,
      false, // autoHandleReorgs - not used in manual script
      cursorRepo,
      eventsRepo,
      blockHashesRepo,
    );

    await reorgDetector.handleReorg(rollbackBlock);
    console.log('✓ Rollback completed');

    // Count events after
    console.log('\n=== STEP 4: Count events after rollback ===');
    const eventsAfter = await pool.query(
      `SELECT COUNT(*) as count FROM ${schema}._events WHERE chain_id = $1 AND block_number >= $2`,
      [chainId, rollbackBlock.toString()],
    );
    console.log('Events >= rollback block:', eventsAfter.rows[0]?.count);

    // Check cursor
    const newCursor = await cursorRepo.getCursor(pool);
    console.log('New cursor:', newCursor?.fetchedToBlock.toString());

    console.log('\n=== RESULTS ===');
    console.log('Events before:', eventsBefore.rows[0]?.count);
    console.log('Events after:', eventsAfter.rows[0]?.count);
    console.log(
      eventsAfter.rows[0]?.count === '0' ? '✓ SUCCESS - All events deleted!' : '✗ FAILED',
    );
  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
