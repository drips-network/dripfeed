-- Persist pending reorg validation metadata so indexer restarts can resume orphan checks.
ALTER TABLE _cursor
  ADD COLUMN IF NOT EXISTS pending_reorg_validation_from_block BIGINT,
  ADD COLUMN IF NOT EXISTS pending_reorg_validation_target_block BIGINT;
