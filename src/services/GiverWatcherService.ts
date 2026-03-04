import type { Pool } from 'pg';
import type { PublicClient } from 'viem';
import { erc20Abi } from 'viem';

import { logger } from '../logger.js';
import type { WatchedGiversRepository, WatchedGiver } from '../repositories/WatchedGiversRepository.js';

type GiverWatcherConfig = {
  pollIntervalMs: number;
  batchSize: number;
};

export class GiverWatcherService {
  private readonly _pool: Pool;
  private readonly _client: PublicClient;
  private readonly _repo: WatchedGiversRepository;
  private readonly _config: GiverWatcherConfig;
  private _running = false;
  private _timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(pool: Pool, client: PublicClient, repo: WatchedGiversRepository, config: GiverWatcherConfig) {
    this._pool = pool;
    this._client = client;
    this._repo = repo;
    this._config = config;
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    logger.info('giver_watcher_started', {
      pollIntervalMs: this._config.pollIntervalMs,
      batchSize: this._config.batchSize,
    });
    void this._poll();
  }

  stop(): void {
    this._running = false;
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
    logger.info('giver_watcher_stopped');
  }

  private async _poll(): Promise<void> {
    if (!this._running) return;

    try {
      let offset = 0;
      let batch: WatchedGiver[];

      do {
        batch = await this._repo.getActiveBatch(this._pool, this._config.batchSize, offset);
        if (batch.length > 0) {
          await this._checkBalances(batch);
        }
        offset += batch.length;
      } while (batch.length === this._config.batchSize);
    } catch (error) {
      logger.error('giver_watcher_poll_error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (this._running) {
      this._timeoutId = setTimeout(() => void this._poll(), this._config.pollIntervalMs);
    }
  }

  private async _checkBalances(givers: WatchedGiver[]): Promise<void> {
    const contracts = givers.map((g) => ({
      address: g.tokenAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [g.giverAddress as `0x${string}`] as const,
    }));

    let results: { status: 'success' | 'failure'; result?: unknown }[];

    try {
      results = (await this._client.multicall({ contracts })) as {
        status: 'success' | 'failure';
        result?: unknown;
      }[];
    } catch (error) {
      logger.error('giver_watcher_multicall_error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (let i = 0; i < givers.length; i++) {
      const giver = givers[i]!;
      const callResult = results[i]!;

      if (callResult.status !== 'success') continue;

      const newBalance = (callResult.result as bigint).toString();
      const previousBalance = giver.lastKnownBalance;

      if (BigInt(newBalance) > BigInt(previousBalance)) {
        await this._repo.updateBalance(this._pool, giver.id, newBalance);

        logger.info('giver_balance_increased', {
          giverAddress: giver.giverAddress,
          tokenAddress: giver.tokenAddress,
          previousBalance,
          newBalance,
        });

        await this._fireWebhook(giver, newBalance, previousBalance);
      }
    }
  }

  private async _fireWebhook(
    giver: WatchedGiver,
    newBalance: string,
    previousBalance: string,
  ): Promise<void> {
    try {
      const response = await fetch(giver.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          giverAddress: giver.giverAddress,
          tokenAddress: giver.tokenAddress,
          newBalance,
          previousBalance,
          metadata: giver.metadata,
        }),
      });

      if (!response.ok) {
        throw new Error(`${response.status} - ${response.statusText} - ${await response.text()}`);
      }

      logger.info('giver_webhook_sent', {
        giverAddress: giver.giverAddress,
        webhookUrl: giver.webhookUrl,
      });
    } catch (error) {
      logger.error('giver_webhook_failed', {
        giverAddress: giver.giverAddress,
        webhookUrl: giver.webhookUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
