import http from 'node:http';

import type { Pool } from 'pg';

import { logger } from './logger.js';
import type { RpcClient } from './core/RpcClient.js';
import type { CursorRepository } from './repositories/CursorRepository.js';

type HealthStatus = {
  status: 'OK' | 'Unhealthy' | 'Error';
  network: string;
  db: 'connected' | 'error';
  rpc: 'connected' | 'error';
  indexing: boolean;
  latestChainBlock?: number;
  lastIndexedBlock?: number;
  progressPercent?: string;
  message?: string;
};

/**
 * Creates and starts a health check HTTP server.
 */
export function createHealthServer(
  pool: Pool,
  rpc: RpcClient,
  cursorRepo: CursorRepository,
  chainId: string,
  network: string,
  port: number,
): http.Server {
  const STALE_TIMEOUT = 5 * 60 * 1000; // 5 minutes.

  let lastIndexedBlock = 0;
  let lastProgressTime = Date.now();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    if (req.method !== 'GET' || url.pathname !== '/api/health') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    let dbHealthy = false;
    let rpcHealthy = false;
    let latestChainBlock: number | undefined;
    let currentIndexedBlock: number | undefined;

    // Check DB health.
    try {
      await pool.query('SELECT 1');
      dbHealthy = true;
    } catch (error: unknown) {
      const err = error as Error;
      logger.error('health_check_db_error', {
        chainId,
        error: err.message,
      });
    }

    // Check RPC health.
    try {
      const blockNum = await rpc.getLatestBlockNumber();
      latestChainBlock = Number(blockNum);
      rpcHealthy = true;
    } catch (error: unknown) {
      const err = error as Error;
      logger.error('health_check_rpc_error', {
        chainId,
        error: err.message,
      });
    }

    // Check indexing progress.
    let indexing = false;
    if (dbHealthy) {
      try {
        const cursor = await cursorRepo.getCursor(pool);
        currentIndexedBlock = cursor ? Number(cursor.fetchedToBlock) : 0;

        if (currentIndexedBlock > lastIndexedBlock) {
          lastIndexedBlock = currentIndexedBlock;
          lastProgressTime = Date.now();
          indexing = true;
        } else if (latestChainBlock !== undefined && currentIndexedBlock >= latestChainBlock) {
          // Caught up with chain - healthy even if no new blocks for >5min.
          indexing = true;
        } else {
          // Check staleness.
          const staleForMs = Date.now() - lastProgressTime;
          indexing = staleForMs < STALE_TIMEOUT;
        }
      } catch (error: unknown) {
        const err = error as Error;
        logger.error('health_check_cursor_error', {
          chainId,
          error: err.message,
        });
      }
    }

    const allHealthy = dbHealthy && rpcHealthy && indexing;

    const progressPercent =
      latestChainBlock !== undefined && currentIndexedBlock !== undefined && latestChainBlock > 0
        ? ((currentIndexedBlock / latestChainBlock) * 100).toFixed(2)
        : undefined;

    const response: HealthStatus = {
      status: allHealthy ? 'OK' : 'Unhealthy',
      network,
      db: dbHealthy ? 'connected' : 'error',
      rpc: rpcHealthy ? 'connected' : 'error',
      indexing,
      ...(latestChainBlock !== undefined && { latestChainBlock }),
      ...(currentIndexedBlock !== undefined && { lastIndexedBlock: currentIndexedBlock }),
      ...(progressPercent !== undefined && { progressPercent: `${progressPercent}%` }),
      ...(allHealthy ? {} : { message: 'One or more health checks failed.' }),
    };

    const statusCode = allHealthy ? 200 : 503;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  });

  server.listen(port, '::', () => {
    logger.info(`✓ Health endpoint: http://localhost:${port}/api/health`);
    logger.info(`✓ Health server started on port ${port}`);
  });

  return server;
}
