import type { Abi } from 'abitype';
import { z } from 'zod';

import { registry } from '../handlers/registry.js';
import type { ContractConfig } from '../core/EventDecoder.js';

import { mainnetConfig } from './mainnet.js';

const contractConfigSchema = z.object({
  name: z.string(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address format'),
  abi: z.custom<Abi>(),
  events: z.array(z.string()),
});

const chainConfigSchema = z.object({
  chainId: z.number().int().positive(),
  startBlock: z.number().int().nonnegative(),
  visibilityThresholdBlockNumber: z.number().int().nonnegative(),
  contracts: z.array(contractConfigSchema).min(1, 'Chain must have at least one contract'),
});

export type ChainConfig = z.infer<typeof chainConfigSchema>;

const configs: Record<string, ChainConfig> = {
  mainnet: mainnetConfig,
};

export function loadChainConfig(network: string): {
  chainId: number;
  startBlock: number;
  visibilityThresholdBlockNumber: number;
  contractConfigs: ContractConfig[];
} {
  const config = configs[network];
  if (!config) {
    throw new Error(`Chain config not found for network: ${network}`);
  }

  const validatedConfig = chainConfigSchema.parse(config);

  const contractConfigs = validatedConfig.contracts.map((contract) => {
    return {
      name: contract.name,
      address: contract.address as `0x${string}`,
      abi: contract.abi,
      handlers: contract.events.map((eventName) => {
        // Validate event exists in ABI.
        const abiEvent = contract.abi.find(
          (item) => item.type === 'event' && 'name' in item && item.name === eventName,
        );
        if (!abiEvent) {
          throw new Error(
            `Event "${eventName}" not found in ABI for contract ${contract.name} (${contract.address}) on network ${network}`,
          );
        }

        // Validate handler exists.
        const handler = registry[eventName];
        if (!handler) {
          throw new Error(
            `No handler found for event: ${eventName} in contract ${contract.name} on network ${network}`,
          );
        }

        return {
          name: eventName,
          handler,
        };
      }),
    };
  });

  return {
    chainId: validatedConfig.chainId,
    startBlock: validatedConfig.startBlock,
    visibilityThresholdBlockNumber: validatedConfig.visibilityThresholdBlockNumber,
    contractConfigs,
  };
}
