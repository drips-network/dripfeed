# Implementation Plan: Dripfeed Extensions

Extend the existing indexer at `/Users/jtourkos/Dev/drips/dripfeed` with giver address watching + webhooks.

## New Files

```
src/
  repositories/WatchedGiversRepository.ts    # CRUD for watched_givers table
  services/GiverWatcherService.ts            # Balance polling loop + webhook dispatch
```

## Modified Files

```
src/db/schema.ts       # Add watched_givers table
src/config.ts          # Add giverWatcher config section
src/health.ts          # Add POST /api/watch endpoint
src/main.ts            # Wire up GiverWatcherService
```

## New Table: `watched_givers`

Add to `src/db/schema.ts`:
```
watched_givers:
  id                  bigserial PK
  giver_address       text NOT NULL
  token_address       text NOT NULL
  chain_id            text NOT NULL
  webhook_url         text NOT NULL
  metadata            jsonb nullable        -- passthrough (e.g. { transactionId: "..." })
  last_known_balance  text NOT NULL default '0'
  is_active           boolean NOT NULL default true
  created_at          timestamp with tz
  updated_at          timestamp with tz

  unique: (giver_address, token_address, chain_id)
  index: is_active WHERE is_active = true
```

## New Endpoint: `POST /api/watch`

Extend `src/health.ts` (the existing raw `http.createServer` callback) with a second route:

Request:
```json
{
  "giverAddress": "0x...",
  "tokenAddress": "0x...",
  "webhookUrl": "https://drip-me.example/api/webhooks/balance-change",
  "metadata": { "transactionId": "uuid" }
}
```

Validates with Zod, upserts into `watched_givers` via repository.

Response: `201 { "status": "watching", "giverAddress": "0x..." }`

## GiverWatcherService

Independent polling loop (not tied to the indexer):

1. Every N ms (configurable, default 10s), fetch all active watched givers from DB
2. Batch `balanceOf` calls via viem `multicall` (efficient — one RPC call for many addresses)
3. Compare with `last_known_balance`
4. If balance increased: update DB, fire webhook to registered URL
5. Webhook payload: `{ giverAddress, tokenAddress, newBalance, previousBalance, metadata }`
6. Webhook dispatch follows `CacheInvalidationService` pattern (src/services/CacheInvalidationService.ts): best-effort POST, catch+log errors, never crash

## Config Changes

Add to `src/config.ts`:
```
GIVER_WATCHER_ENABLED=true|false
GIVER_WATCHER_POLL_INTERVAL_MS=10000
GIVER_WATCHER_BATCH_SIZE=50
```

## Integration with main.ts

- Create `WatchedGiversRepository` with the DB schema name
- Pass it to `createHealthServer` (new parameter for the watch endpoint)
- If `giverWatcher.enabled`: create `GiverWatcherService` with pool, viem publicClient, repo, config
- Start the watcher loop in background (non-blocking, alongside the indexer)
- Stop the watcher on shutdown

## Implementation Order

1. Add `watched_givers` table to `src/db/schema.ts`
2. Run `npm run db:generate` to create migration
3. Add config section to `src/config.ts`
4. Create `src/repositories/WatchedGiversRepository.ts` (follow existing repo patterns: raw SQL, schema-qualified tables, Zod validation)
5. Extend `src/health.ts` with `POST /api/watch` route
6. Create `src/services/GiverWatcherService.ts` (polling loop + webhook dispatch)
7. Wire everything in `src/main.ts`
8. Test: register a watch, send USDC on Sepolia, verify webhook fires

## Key Reference Files

- `src/health.ts` — HTTP server to extend
- `src/db/schema.ts` — table definition patterns
- `src/config.ts` — Zod config patterns
- `src/repositories/CursorRepository.ts` — repository pattern (raw SQL, schema-qualified)
- `src/services/CacheInvalidationService.ts` — webhook dispatch pattern (best-effort POST)
- `src/main.ts` — startup wiring

## Verification

1. Run migration: `npm run db:migrate`
2. Start with `GIVER_WATCHER_ENABLED=true`
3. `POST /api/watch` registers a giver address
4. Send USDC to the giver address on Sepolia
5. Verify: webhook fires to the registered URL with correct payload
6. Verify: `last_known_balance` updated in DB

## End-to-end (with drip-me)

1. Create transaction via drip-me API
2. Send USDC to the returned giver address on Sepolia
3. Dripfeed detects balance, fires webhook to drip-me
4. drip-me receives webhook, calls GiversRegistry.give() + Drips.split()
5. Transaction status progresses: awaiting_payment → payment_detected → funds_sweeping → funds_splitting → funds_processing
