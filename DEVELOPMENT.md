# Development Guide

## ⛓️ New Chain (Config)

To add support for a new blockchain network:

1. Create a new chain config file in `src/chain-configs/<network-name>.ts`:

```typescript
import type { ChainConfig } from './loadChainConfig.js';

export const <network-name>Config: ChainConfig = {
  chainId: <chain-id>,
  startBlock: <starting-block-number>,
  visibilityThresholdBlockNumber: <threshold-block-number>,
  contracts: [
    {
      name: '<ContractName>',
      address: '<0x-contract-address>',
      abi: <abiImport>,
      events: ['EventName1', 'EventName2'],
    },
  ],
};
```

2. Register the config in `src/chain-configs/loadChainConfig.ts`:

```typescript
import { <network-name>Config } from './<network-name>.js';

const configs: Record<string, ChainConfig> = {
  // ...existing configs
  '<network-name>': <network-name>Config,
};
```

3. Set the `NETWORK` environment variable to match your config name.

**Important constraints:**

- **One indexer per chain per schema**: Each chain must use a unique `DB_SCHEMA`. Only one indexer instance should run per chain per schema.
- Chain config is baked into the codebase and selected at startup via the `NETWORK` environment variable.

## 📝 New Contract

To add a new contract to monitor on an existing chain:

1. Define or import the contract ABI in `src/chain-configs/all-chains.ts` or the chain-specific config file.

2. Add the contract to the `contracts` array in your chain config:

```typescript
contracts: [
  {
    name: 'MyNewContract',
    address: '0x...',
    abi: myNewContractAbi,
    events: ['EventName1', 'EventName2'],
  },
];
```

3. The contract config specifies:
   - `name`: Contract identifier (for logging/debugging).
   - `address`: Deployed contract address.
   - `abi`: Contract ABI.
   - `events`: List of event names to index from this contract.

## 🎯 New Event (Handler)

To add support for a new blockchain event:

1. Create a handler function in `src/handlers/<event-name>Handler.ts`:

```typescript
import type { EventHandler, HandlerEvent } from './EventHandler.js';
import type { DecodeEventLogReturnType } from 'viem';
import type { YourContractAbi } from '../chain-configs/all-chains.js';

type YourEventEvent = HandlerEvent & {
  args: DecodeEventLogReturnType<YourContractAbi, 'YourEvent'>['args'];
};

export const yourEventHandler: EventHandler<YourEventEvent> = async (event, ctx) => {
  const { arg1, arg2 } = event.args;
  const { someRepo, someService } = ctx;

  // Process the event using domain logic.
  // Call repository methods to persist changes.

  await someRepo.updateSomeEntity({
    // ... update data
  });
};
```

2. Register the handler in `src/handlers/registry.ts`:

```typescript
import { yourEventHandler } from './yourEventHandler.js';

export const registry: Record<string, EventHandler> = {
  // ...existing handlers
  YourEvent: yourEventHandler as EventHandler,
};
```

3. Add the event name to the relevant contract's `events` array in your chain config.

**Important notes:**

- **Idempotency**: Where possible, design handlers to be idempotent so reprocessing the same event produces the same result. This is critical for reorg handling and replay scenarios.
- Handlers receive a `HandlerContext` with access to repositories and services.
- Use repository `upsert` or `update` methods to ensure replayability.
