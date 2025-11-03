import type { PoolClient } from 'pg';
import { createSelectSchema } from 'drizzle-zod';
import type { z } from 'zod';

import { dripLists, ecosystemMainAccounts, pendingNftTransfers } from '../db/schema.js';
import { validateSchemaName } from '../utils/sqlValidation.js';

import type { EventPointer } from './types.js';

const pendingNftTransferSchema = createSelectSchema(pendingNftTransfers);
export type PendingNftTransfer = z.infer<typeof pendingNftTransferSchema>;

export const dripListSchema = createSelectSchema(dripLists);
export type DripList = z.infer<typeof dripListSchema>;

export const ecosystemSchema = createSelectSchema(ecosystemMainAccounts);
export type Ecosystem = z.infer<typeof ecosystemSchema>;

const upsertPendingNftTransferInputSchema = pendingNftTransferSchema.omit({
  created_at: true,
  updated_at: true,
  last_event_block: true,
  last_event_tx_index: true,
  last_event_log_index: true,
});

export type UpsertPendingNftTransferData = z.infer<typeof upsertPendingNftTransferInputSchema>;

/**
 * Repository for pending NFT transfers (entities whose type is not yet known).
 */
export class PendingNftTransfersRepository {
  constructor(
    private readonly client: PoolClient,
    private readonly schema: string,
  ) {
    validateSchemaName(schema);
  }

  /**
   * Upserts a pending NFT transfer record.
   *
   * This is called when a Transfer event is processed but we don't yet know
   * if the entity is a Drip List or Ecosystem. Subsequent transfers update
   * the owner information.
   *
   * @param data - Pending NFT transfer data.
   * @param eventPointer - Blockchain event that triggered this operation.
   * @returns The persisted pending NFT transfer row.
   */
  async upsertPendingNftTransfer(
    data: UpsertPendingNftTransferData,
    eventPointer: EventPointer,
  ): Promise<PendingNftTransfer> {
    upsertPendingNftTransferInputSchema.parse(data);

    const result = await this.client.query<PendingNftTransfer>(
      `
      INSERT INTO ${this.schema}._pending_nft_transfers (
        account_id,
        owner_address,
        owner_account_id,
        creator,
        previous_owner_address,
        is_visible,
        block_number,
        last_event_block,
        last_event_tx_index,
        last_event_log_index,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      ON CONFLICT (account_id) DO UPDATE SET
        owner_address = EXCLUDED.owner_address,
        owner_account_id = EXCLUDED.owner_account_id,
        creator = EXCLUDED.creator,
        previous_owner_address = EXCLUDED.previous_owner_address,
        is_visible = EXCLUDED.is_visible,
        block_number = EXCLUDED.block_number,
        last_event_block = EXCLUDED.last_event_block,
        last_event_tx_index = EXCLUDED.last_event_tx_index,
        last_event_log_index = EXCLUDED.last_event_log_index,
        updated_at = NOW()
      RETURNING *
      `,
      [
        data.account_id,
        data.owner_address,
        data.owner_account_id,
        data.creator ?? null,
        data.previous_owner_address ?? null,
        data.is_visible,
        data.block_number.toString(),
        eventPointer.last_event_block.toString(),
        eventPointer.last_event_tx_index,
        eventPointer.last_event_log_index,
      ],
    );

    const transfer = pendingNftTransferSchema.parse(result.rows[0]);
    return transfer;
  }

  /**
   * Atomically migrates a pending NFT transfer to drip_lists table.
   *
   * Deletes from _pending_nft_transfers and upserts into drip_lists in a single CTE.
   * This prevents inconsistency from crashes between separate operations.
   *
   * @param accountId - The account ID to migrate.
   * @param isVisible - Visibility flag for the drip list.
   * @param eventPointer - Blockchain event that triggered this operation.
   * @returns Object with wasMigrated flag and the created/updated drip list, or null if no pending data.
   */
  async migratePendingToDripList(
    accountId: string,
    isVisible: boolean,
    eventPointer: EventPointer,
  ): Promise<{ wasMigrated: true; dripList: DripList } | { wasMigrated: false }> {
    const result = await this.client.query(
      `
      WITH deleted AS (
        DELETE FROM ${this.schema}._pending_nft_transfers
        WHERE account_id = $1
        RETURNING *
      ),
      inserted AS (
        INSERT INTO ${this.schema}.drip_lists (
          account_id,
          owner_address,
          owner_account_id,
          creator,
          previous_owner_address,
          is_valid,
          is_visible,
          last_event_block,
          last_event_tx_index,
          last_event_log_index,
          created_at,
          updated_at
        )
        SELECT
          account_id,
          owner_address,
          owner_account_id,
          creator,
          previous_owner_address,
          true,
          $2,
          $3,
          $4,
          $5,
          NOW(),
          NOW()
        FROM deleted
        ON CONFLICT (account_id) DO UPDATE SET
          owner_address = EXCLUDED.owner_address,
          owner_account_id = EXCLUDED.owner_account_id,
          creator = EXCLUDED.creator,
          previous_owner_address = EXCLUDED.previous_owner_address,
          is_valid = EXCLUDED.is_valid,
          is_visible = EXCLUDED.is_visible,
          last_event_block = EXCLUDED.last_event_block,
          last_event_tx_index = EXCLUDED.last_event_tx_index,
          last_event_log_index = EXCLUDED.last_event_log_index,
          updated_at = NOW()
        RETURNING *
      )
      SELECT * FROM inserted
    `,
      [
        accountId,
        isVisible,
        eventPointer.last_event_block.toString(),
        eventPointer.last_event_tx_index,
        eventPointer.last_event_log_index,
      ],
    );

    if (result.rows.length === 0) {
      return { wasMigrated: false };
    }

    const dripList = dripListSchema.parse(result.rows[0]);
    return { wasMigrated: true, dripList };
  }

  /**
   * Atomically migrates a pending NFT transfer to ecosystem_main_accounts table.
   *
   * Deletes from _pending_nft_transfers and upserts into ecosystem_main_accounts in a single CTE.
   * This prevents inconsistency from crashes between separate operations.
   *
   * @param accountId - The account ID to migrate.
   * @param isVisible - Visibility flag for the ecosystem.
   * @param lastProcessedIpfsHash - IPFS hash of the metadata.
   * @param avatar - Avatar string.
   * @param color - Color string.
   * @param eventPointer - Blockchain event that triggered this operation.
   * @returns Object with wasMigrated flag and the created/updated ecosystem, or null if no pending data.
   */
  async migratePendingToEcosystem(
    accountId: string,
    isVisible: boolean,
    lastProcessedIpfsHash: string,
    avatar: string,
    color: string,
    eventPointer: EventPointer,
  ): Promise<{ wasMigrated: true; ecosystem: Ecosystem } | { wasMigrated: false }> {
    const result = await this.client.query(
      `
      WITH deleted AS (
        DELETE FROM ${this.schema}._pending_nft_transfers
        WHERE account_id = $1
        RETURNING *
      ),
      inserted AS (
        INSERT INTO ${this.schema}.ecosystem_main_accounts (
          account_id,
          owner_address,
          owner_account_id,
          creator,
          previous_owner_address,
          is_valid,
          is_visible,
          last_processed_ipfs_hash,
          avatar,
          color,
          last_event_block,
          last_event_tx_index,
          last_event_log_index,
          created_at,
          updated_at
        )
        SELECT
          account_id,
          owner_address,
          owner_account_id,
          creator,
          previous_owner_address,
          true,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          NOW(),
          NOW()
        FROM deleted
        ON CONFLICT (account_id) DO UPDATE SET
          owner_address = EXCLUDED.owner_address,
          owner_account_id = EXCLUDED.owner_account_id,
          creator = EXCLUDED.creator,
          previous_owner_address = EXCLUDED.previous_owner_address,
          is_valid = EXCLUDED.is_valid,
          is_visible = EXCLUDED.is_visible,
          last_processed_ipfs_hash = EXCLUDED.last_processed_ipfs_hash,
          avatar = EXCLUDED.avatar,
          color = EXCLUDED.color,
          last_event_block = EXCLUDED.last_event_block,
          last_event_tx_index = EXCLUDED.last_event_tx_index,
          last_event_log_index = EXCLUDED.last_event_log_index,
          updated_at = NOW()
        RETURNING *
      )
      SELECT * FROM inserted
    `,
      [
        accountId,
        isVisible,
        lastProcessedIpfsHash,
        avatar,
        color,
        eventPointer.last_event_block.toString(),
        eventPointer.last_event_tx_index,
        eventPointer.last_event_log_index,
      ],
    );

    if (result.rows.length === 0) {
      return { wasMigrated: false };
    }

    const ecosystem = ecosystemSchema.parse(result.rows[0]);
    return { wasMigrated: true, ecosystem };
  }
}
