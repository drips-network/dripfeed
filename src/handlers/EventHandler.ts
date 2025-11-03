import type { PoolClient } from 'pg';

import type { PendingNftTransfersRepository } from '../repositories/PendingNftTransfersRepository.js';
import type { SplitsRepository } from '../repositories/SplitsRepository.js';
import type { CacheInvalidationService } from '../services/CacheInvalidationService.js';
import type { Contracts } from '../services/Contracts.js';
import type { MetadataService } from '../services/MetadataService.js';

/**
 * Event handler function signature.
 *
 * Handlers perform domain logic and mutate entities through repositories.
 *
 * Handlers should:
 * - Process events using domain logic.
 * - Call repository mutation methods to persist changes.
 *
 * @param event - The blockchain event to process.
 * @param ctx - Handler context (repositories, services).
 */
export type EventHandler<TEvent extends HandlerEvent = HandlerEvent> = (
  event: TEvent,
  ctx: HandlerContext,
) => Promise<void>;

export type HandlerEvent = {
  chainId: string;
  blockNumber: bigint;
  blockTimestamp: Date;
  txIndex: number;
  logIndex: number;
  txHash: `0x${string}`;
  blockHash: `0x${string}`;
  contractAddress: `0x${string}`;
  eventName: string;
  eventSig: `0x${string}`;
  args: Record<string, unknown>;
};

export type HandlerContext = {
  readonly client: PoolClient;
  readonly schema: string;
  readonly splitsRepo: SplitsRepository;
  readonly pendingNftTransfersRepo: PendingNftTransfersRepository;
  readonly metadataService: MetadataService;
  readonly contracts: Contracts;
  readonly cacheInvalidationService: CacheInvalidationService;
  readonly visibilityThresholdBlockNumber: bigint;
};
