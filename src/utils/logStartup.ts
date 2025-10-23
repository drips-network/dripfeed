import type { Config } from '../config.js';
import type { ContractConfig } from '../core/EventDecoder.js';
import { logger } from '../logger.js';

function maskRpcUrl(rpcUrl: string): string {
  try {
    const url = new URL(rpcUrl);
    return `${url.protocol}//${url.host}/***`;
  } catch {
    return '***';
  }
}

export function logStartup(runtimeConfig: Config, contractConfigs: ContractConfig[]) {
  const maskedRpcUrl = maskRpcUrl(runtimeConfig.chain.rpcUrl);

  const totalEvents = contractConfigs.reduce((sum, c) => sum + c.handlers.length, 0);

  logger.info('dripfeed starting...');
  logger.info(
    `✓ Network: ${runtimeConfig.network} (chain ${runtimeConfig.chain.id}, starting at block ${runtimeConfig.chain.startBlock}, visibility threshold ${runtimeConfig.chain.visibilityThresholdBlockNumber})`,
  );
  logger.info(`✓ Database: schema=${runtimeConfig.database.schema}`);
  logger.info(`✓ RPC: ${maskedRpcUrl}`);
  logger.info(`✓ Contracts: ${contractConfigs.length} registered (${totalEvents} events total)`);

  contractConfigs.forEach((c) => {
    if (c.handlers.length > 0) {
      const events = c.handlers.map((e) => e.name).join(', ');
      logger.info(`  • ${c.name}: ${events}`);
    }
  });
}
