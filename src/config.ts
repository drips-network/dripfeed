import { config as loadEnv } from 'dotenv';
import { expand } from 'dotenv-expand';
import { z } from 'zod';

expand(loadEnv());

const configSchema = z.object({
  network: z.string().min(1),
  database: z.object({
    url: z.url(),
    schema: z.string().min(1),
  }),
  chain: z.object({
    id: z.number().int().positive().optional(), // Optional during parse
    rpcUrl: z.url(),
    confirmations: z.number().int().nonnegative().default(1),
    startBlock: z.number().int().nonnegative().optional(), // Optional during parse
    visibilityThresholdBlockNumber: z.number().int().nonnegative().optional(), // Optional during parse
  }),
  indexer: z.object({
    fetchBatchSize: z.number().int().positive().default(500),
    insertChunkSize: z.number().int().positive().default(1000),
    processBatchSize: z.number().int().positive().default(100),
    pollDelay: z.number().int().nonnegative().default(5000),
    maxConsecutiveErrors: z.number().int().positive().default(10),
    rpcConcurrency: z.number().int().positive().default(10),
    autoHandleReorgs: z.boolean().default(false),
  }),
  logging: z.object({
    level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),
    pretty: z.boolean().default(false),
  }),
  ipfs: z.object({
    gatewayUrl: z.string().url().default('https://drips.mypinata.cloud'),
  }),
  cache: z.object({
    invalidationEndpoint: z.string().url().optional(),
  }),
  health: z.object({
    port: z.number().int().positive().default(3000),
  }),
});

export const runtimeConfigSchema = configSchema.extend({
  chain: configSchema.shape.chain.extend({
    id: z.number().int().positive(), // Required at runtime
    startBlock: z.number().int().nonnegative(), // Required at runtime
    visibilityThresholdBlockNumber: z.number().int().nonnegative(), // Required at runtime
  }),
});

export type Config = z.infer<typeof configSchema>;
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

function loadConfig(): Config {
  const raw = {
    network: process.env.NETWORK,
    database: {
      url: process.env.DATABASE_URL,
      schema: process.env.DB_SCHEMA,
    },
    chain: {
      rpcUrl: process.env.RPC_URL,
      confirmations: process.env.CONFIRMATIONS
        ? parseInt(process.env.CONFIRMATIONS, 10)
        : undefined,
    },
    indexer: {
      fetchBatchSize: process.env.FETCH_BATCH_SIZE
        ? parseInt(process.env.FETCH_BATCH_SIZE, 10)
        : undefined,
      insertChunkSize: process.env.INSERT_CHUNK_SIZE
        ? parseInt(process.env.INSERT_CHUNK_SIZE, 10)
        : undefined,
      processBatchSize: process.env.PROCESS_BATCH_SIZE
        ? parseInt(process.env.PROCESS_BATCH_SIZE, 10)
        : undefined,
      pollDelay: process.env.POLL_DELAY ? parseInt(process.env.POLL_DELAY, 10) : undefined,
      maxConsecutiveErrors: process.env.MAX_CONSECUTIVE_ERRORS
        ? parseInt(process.env.MAX_CONSECUTIVE_ERRORS, 10)
        : undefined,
      rpcConcurrency: process.env.RPC_CONCURRENCY
        ? parseInt(process.env.RPC_CONCURRENCY, 10)
        : undefined,
      autoHandleReorgs: process.env.AUTO_HANDLE_REORGS === 'true',
    },
    logging: {
      level: process.env.LOG_LEVEL,
      pretty: process.env.LOG_PRETTY === 'true',
    },
    ipfs: {
      gatewayUrl: process.env.IPFS_GATEWAY_URL,
    },
    cache: {
      invalidationEndpoint: process.env.CACHE_INVALIDATION_ENDPOINT || undefined,
    },
    health: {
      port: process.env.HEALTH_PORT ? parseInt(process.env.HEALTH_PORT, 10) : undefined,
    },
  };

  return configSchema.parse(raw);
}

export const config = loadConfig();
