import { logger } from '../logger.js';

export class CacheInvalidationService {
  constructor(
    private readonly _endpoint: string | undefined,
    private readonly _minAgeMinutes: number = 15,
  ) {}

  async invalidate(accountIds: string[], blockTimestamp: Date): Promise<void> {
    if (!this._endpoint) {
      return;
    }

    if (accountIds.length === 0) {
      return;
    }

    // Skip invalidation for old blocks to avoid unnecessary requests during indexing.
    if (new Date(blockTimestamp).getTime() < Date.now() - this._minAgeMinutes * 60000) {
      return;
    }

    try {
      const response = await fetch(this._endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accountIds),
      });

      if (!response.ok) {
        throw new Error(`${response.status} - ${response.statusText} - ${await response.text()}`);
      }

      logger.info('cache_invalidated', {
        accountIds,
        count: accountIds.length,
      });
    } catch (error) {
      logger.error('cache_invalidation_failed', {
        accountIds,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
