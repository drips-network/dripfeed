import { type Address, type Hex, type Log, type PublicClient } from 'viem';

import { logger } from '../logger.js';
import { sleep } from '../utils/sleep.js';

/**
 * RPC configuration.
 */
type RpcConfig = {
  chainId: number;
  timeout?: number;
  retries?: number;
  concurrency?: number;
};

/**
 * Block metadata from RPC.
 */
export type BlockSummary = {
  number: bigint;
  hash: Hex;
  timestamp: bigint;
};

/**
 * Error classification for retry logic.
 */
type ErrorType = 'transient' | 'permanent';

/**
 * RPC client for fetching blockchain logs with retry logic and timeout handling.
 */
export class RpcClient {
  private readonly _client: PublicClient;
  private readonly _chainId: string;
  private readonly _timeout: number;
  private readonly _maxRetries: number;
  private readonly _concurrency: number;
  private readonly _totalTimeout: number;

  constructor(client: PublicClient, config: RpcConfig) {
    this._client = client;
    this._chainId = config.chainId.toString();
    this._timeout = Math.min(config.timeout ?? 30000, 60000); // Default to 30s but never exceed 60s.
    this._maxRetries = config.retries ?? 3;
    this._concurrency = config.concurrency ?? 10;
    this._totalTimeout = this._timeout * this._maxRetries; // Total timeout including retries.
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return this._withRetry(() => this._client.getBlockNumber(), 'getBlockNumber');
  }

  /**
   * Returns safe block number accounting for required confirmations.
   */
  getSafeBlockNumber(head: bigint, confirmations: number): bigint {
    const offset = BigInt(confirmations);
    if (head <= offset) {
      throw new Error(
        `Chain ${this._chainId}: insufficient blocks (head=${head}, required=${offset + 1n})`,
      );
    }
    return head - offset;
  }

  /**
   * Fetches block metadata for a range with controlled concurrency.
   * Skips null rounds (e.g., Filecoin epochs with no block).
   */
  async getBlocksInRange(fromBlock: bigint, toBlock: bigint): Promise<BlockSummary[]> {
    if (toBlock < fromBlock) {
      return [];
    }

    const count = Number(toBlock - fromBlock + 1n);
    const blockNumbers = Array.from({ length: count }, (_, index) => fromBlock + BigInt(index));
    const results: BlockSummary[] = [];

    for (let i = 0; i < blockNumbers.length; i += this._concurrency) {
      const chunk = blockNumbers.slice(i, i + this._concurrency);
      const blocks = await Promise.all(chunk.map((blockNumber) => this.getBlock(blockNumber)));

      results.push(...blocks.filter((block): block is BlockSummary => block !== null));
    }

    return results;
  }

  /**
   * Fetches single block metadata.
   * Returns null for null rounds (e.g., Filecoin epochs with no block).
   */
  async getBlock(blockNumber: bigint): Promise<BlockSummary | null> {
    try {
      const block = await this._withRetry(
        () =>
          this._client.getBlock({
            blockNumber,
            includeTransactions: false,
          }),
        'getBlock',
      );
      return { number: block.number, hash: block.hash, timestamp: block.timestamp };
    } catch (error) {
      if (this._isNullRoundError(error)) {
        logger.debug('null_round_skipped', {
          chainId: this._chainId,
          blockNumber: blockNumber.toString(),
        });
        return null;
      }
      throw error;
    }
  }

  /**
   * Fetches logs for specified contracts within block range.
   */
  async getLogs(addresses: readonly Address[], fromBlock: bigint, toBlock: bigint): Promise<Log[]> {
    if (addresses.length === 0) {
      return [];
    }
    const endTimer = logger.startTimer('rpc_get_logs');
    const result = await this._withRetry(
      () =>
        this._client.getLogs({
          address: addresses as Address[],
          fromBlock,
          toBlock,
        }),
      'getLogs',
    );
    endTimer();
    return result;
  }

  /**
   * Execute operation with retry logic and exponential backoff.
   */
  private async _withRetry<T>(operation: () => Promise<T>, context: string): Promise<T> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this._maxRetries; attempt++) {
      // Check if total timeout exceeded.
      if (Date.now() - startTime >= this._totalTimeout) {
        throw new Error(
          `Chain ${this._chainId}: ${context} exceeded total timeout of ${this._totalTimeout}ms after ${attempt} attempts`,
        );
      }

      try {
        const result = await this._withTimeout(operation(), context);

        // Log successful retry after previous failures.
        if (attempt > 0) {
          logger.info('rpc_retry_success', {
            chainId: this._chainId,
            context,
            attempt,
          });
        }

        return result;
      } catch (error) {
        lastError = error as Error;
        const errorType = this._classifyError(lastError);

        // Log null rounds at DEBUG, other errors at ERROR.
        if (this._isNullRoundError(lastError)) {
          logger.debug('rpc_null_round', {
            chainId: this._chainId,
            context,
            error: lastError.message,
            retryCount: attempt,
          });
        } else {
          logger.error('rpc_error', {
            chainId: this._chainId,
            context,
            error: lastError.message,
            retryCount: attempt,
          });
        }

        if (errorType === 'permanent') {
          throw new Error(`Chain ${this._chainId}: ${context} failed: ${lastError.message}`);
        }

        if (attempt < this._maxRetries - 1) {
          const backoffMs = Math.pow(2, attempt) * 1000 * (0.5 + Math.random());
          await sleep(backoffMs);
        }
      }
    }

    throw new Error(
      `Chain ${this._chainId}: ${context} failed after ${this._maxRetries} attempts: ${lastError?.message}`,
    );
  }

  /**
   * Wraps operation with timeout to prevent hanging indefinitely.
   */
  private async _withTimeout<T>(operation: Promise<T>, context: string): Promise<T> {
    let timeoutId: NodeJS.Timeout;
    return Promise.race([
      operation.finally(() => clearTimeout(timeoutId)),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${context} timed out after ${this._timeout}ms`)),
          this._timeout,
        );
      }),
    ]);
  }

  /**
   * Classify error as transient or permanent.
   */
  private _classifyError(error: Error): ErrorType {
    const message = error.message.toLowerCase();
    const errorObj = error as { code?: number | string };

    // Check for JSON-RPC error codes.
    if (errorObj.code !== undefined) {
      let code: number | undefined;
      if (typeof errorObj.code === 'number') {
        code = errorObj.code;
      } else if (typeof errorObj.code === 'string') {
        const parsed = parseInt(errorObj.code, 10);
        code = isNaN(parsed) ? undefined : parsed;
      }

      if (code !== undefined && (code === -32602 || code === -32600 || code === -32601)) {
        return 'permanent';
      }
    }

    // Permanent errors (invalid params, not found, null rounds, etc.).
    if (
      message.includes('invalid') ||
      message.includes('not found') ||
      message.includes('unsupported') ||
      message.includes('bad request') ||
      this._isNullRoundError(error)
    ) {
      return 'permanent';
    }

    // Transient errors (network, timeout, rate limit, etc.).
    return 'transient';
  }

  /**
   * Checks if error is a null round error (Filecoin-specific).
   */
  private _isNullRoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.toLowerCase().includes('null round');
  }
}
