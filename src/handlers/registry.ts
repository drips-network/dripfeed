import { accountMetadataEmittedHandler } from './AccountMetadataEmitted/accountMetadataEmittedHandler.js';
import type { EventHandler } from './EventHandler.js';
import { noOpHandler } from './noOpHandler.js';
import { ownerUpdatedHandler } from './ownerUpdatedHandler.js';
import { ownerUpdateRequestedHandler } from './ownerUpdateRequestedHandler.js';
import { splitsSetHandler } from './splitsSetHandler.js';
import { streamReceiverSeenHandler } from './streamReceiverSeenHandler.js';
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
  Given: noOpHandler,
  Split: noOpHandler,
  StreamsSet: noOpHandler,
  SqueezedStreams: noOpHandler,
  Transfer: transferHandler as EventHandler,
  SplitsSet: splitsSetHandler as EventHandler,
  OwnerUpdated: ownerUpdatedHandler as EventHandler,
  StreamReceiverSeen: streamReceiverSeenHandler as EventHandler,
  OwnerUpdateRequested: ownerUpdateRequestedHandler as EventHandler,
  AccountMetadataEmitted: accountMetadataEmittedHandler as EventHandler,
};
