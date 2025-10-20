/**
 * Result of an update operation.
 */
export type UpdateResult<T> = { success: true; data: T } | { success: false; reason: 'not_found' };

/**
 * Event pointer that tracks which blockchain event created or last modified an entity.
 */
export type EventPointer = {
  last_event_block: bigint;
  last_event_tx_index: number;
  last_event_log_index: number;
};

/**
 * Creates an EventPointer from a HandlerEvent.
 */
export function toEventPointer(event: {
  blockNumber: bigint;
  txIndex: number;
  logIndex: number;
}): EventPointer {
  return {
    last_event_block: event.blockNumber,
    last_event_tx_index: event.txIndex,
    last_event_log_index: event.logIndex,
  };
}
