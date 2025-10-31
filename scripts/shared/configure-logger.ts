/* eslint-disable @typescript-eslint/no-explicit-any */
import { config } from '../../src/config.js';
import { logger } from '../../src/logger.js';

/**
 * Configure logger for scripts to always use DEBUG level with pretty formatting.
 * Call this after importing config but before importing any modules that use the logger.
 */
export function configureScriptLogger(): void {
  // Force debug logging for scripts.
  (config.logging as any).level = 'DEBUG';
  (config.logging as any).pretty = true;

  // Apply configuration to logger singleton.
  logger.setPrettyFormat(config.logging.pretty).setMinLevel(config.logging.level);
}
