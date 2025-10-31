/**
 * Shared formatting utilities for CLI scripts.
 */

/**
 * Format a date for display.
 */
export function formatDate(date: Date | null): string {
  if (!date) return 'N/A';
  return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

/**
 * Format a large number with commas.
 */
export function formatNumber(num: number | bigint): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
