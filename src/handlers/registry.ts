import { accountMetadataEmittedHandler } from './AccountMetadataEmitted/accountMetadataEmittedHandler.js';
import type { EventHandler } from './EventHandler.js';
import { givenHandler } from './givenHandler.js';
import { ownerUpdatedHandler } from './ownerUpdatedHandler.js';
import { ownerUpdateRequestedHandler } from './ownerUpdateRequestedHandler.js';
import { splitHandler } from './splitHandler.js';
import { splitsSetHandler } from './splitsSetHandler.js';
import { squeezedStreamsHandler } from './squeezedStreamsHandler.js';
import { streamReceiverSeenHandler } from './streamReceiverSeenHandler.js';
import { streamsSetHandler } from './streamsSetHandler.js';
import { transferHandler } from './transferHandler.js';

/**
 * Registry mapping blockchain event names to their handler functions.
 *
 * Used by the event processor to route incoming events to the appropriate handler.
 *
 * **IMPORTANT**: All handlers MUST be created using `createHandler()` to enforce
 * compile-time entity tracking. Direct EventHandler implementations will not
 * enforce tracking and should not be added to this registry.
 *
 * @see {@link createHandler} for creating type-safe handlers with tracking.
 */
export const registry: Record<string, EventHandler> = {
  Split: splitHandler as EventHandler,
  Given: givenHandler as EventHandler,
  Transfer: transferHandler as EventHandler,
  SplitsSet: splitsSetHandler as EventHandler,
  StreamsSet: streamsSetHandler as EventHandler,
  OwnerUpdated: ownerUpdatedHandler as EventHandler,
  SqueezedStreams: squeezedStreamsHandler as EventHandler,
  StreamReceiverSeen: streamReceiverSeenHandler as EventHandler,
  OwnerUpdateRequested: ownerUpdateRequestedHandler as EventHandler,
  AccountMetadataEmitted: accountMetadataEmittedHandler as EventHandler,
};
