import type { Config } from '../config.js';
import type { ContractConfig } from '../core/EventDecoder.js';
import { logger } from '../logger.js';

export function logRuntimeConfig(runtimeConfig: Config, contractConfigs: ContractConfig[]) {
  logger.info('chain_config_loaded', {
    ...runtimeConfig,
    database: { schema: runtimeConfig.database.schema },
    chain: {
      ...runtimeConfig.chain,
      rpcUrl: (() => {
        try {
          const url = new URL(runtimeConfig.chain.rpcUrl);
          return `${url.protocol}//${url.host}/***`;
        } catch {
          return '***';
        }
      })(),
    },
    contracts: contractConfigs.map((c) => ({
      name: c.name,
      address: c.address,
      eventCount: c.handlers.length,
      events: c.handlers.map((e) => e.name),
    })),
  });
}
