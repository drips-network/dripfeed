import type { EventHandler } from './EventHandler.js';

/**
 * No-op handler for events that should be indexed without custom processing.
 * Event data is stored in the database but no business logic is executed.
 */
export const noOpHandler: EventHandler = async (_event, _ctx) => {
  // No-op: no mutations, no tracking
};
