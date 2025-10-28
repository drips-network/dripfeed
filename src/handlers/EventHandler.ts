import type { DripListsRepository } from '../repositories/DripListsRepository.js';
import type { EcosystemsRepository } from '../repositories/EcosystemsRepository.js';
import type { LinkedIdentitiesRepository } from '../repositories/LinkedIdentitiesRepository.js';
import type { PendingNftTransfersRepository } from '../repositories/PendingNftTransfersRepository.js';
import type { ProjectsRepository } from '../repositories/ProjectsRepository.js';
import type { SplitEventsRepository } from '../repositories/SplitEventsRepository.js';
import type { SplitsRepository } from '../repositories/SplitsRepository.js';
import type { SubListsRepository } from '../repositories/SubListsRepository.js';
import type { GivenEventsRepository } from '../repositories/GivenEventsRepository.js';
import type { SqueezedStreamsEventsRepository } from '../repositories/SqueezedStreamsEventsRepository.js';
import type { StreamsSetEventsRepository } from '../repositories/StreamsSetEventsRepository.js';
import type { SplitsSetEventsRepository } from '../repositories/SplitsSetEventsRepository.js';
import type { AccountMetadataEmittedEventsRepository } from '../repositories/AccountMetadataEmittedEventsRepository.js';
import type { StreamReceiverSeenEventsRepository } from '../repositories/StreamReceiverSeenEventsRepository.js';
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
  readonly projectsRepo: ProjectsRepository;
  readonly linkedIdentitiesRepo: LinkedIdentitiesRepository;
  readonly splitsRepo: SplitsRepository;
  readonly dripListsRepo: DripListsRepository;
  readonly ecosystemsRepo: EcosystemsRepository;
  readonly subListsRepo: SubListsRepository;
  readonly pendingNftTransfersRepo: PendingNftTransfersRepository;
  readonly givenEventsRepo: GivenEventsRepository;
  readonly splitEventsRepo: SplitEventsRepository;
  readonly squeezedStreamsEventsRepo: SqueezedStreamsEventsRepository;
  readonly streamsSetEventsRepo: StreamsSetEventsRepository;
  readonly splitsSetEventsRepo: SplitsSetEventsRepository;
  readonly accountMetadataEmittedEventsRepo: AccountMetadataEmittedEventsRepository;
  readonly streamReceiverSeenEventsRepo: StreamReceiverSeenEventsRepository;
  readonly metadataService: MetadataService;
  readonly contracts: Contracts;
  readonly cacheInvalidationService: CacheInvalidationService;
  readonly visibilityThresholdBlockNumber: bigint;
};
