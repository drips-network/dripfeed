import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// Enums
export const forgeEnum = pgEnum('forges', ['github', 'gitlab']);
export const projectStatusEnum = pgEnum('verification_status', [
  'claimed',
  'unclaimed',
  'pending_metadata',
]);
export const eventStatusEnum = pgEnum('status', ['pending', 'processed', 'failed']);
export const accountTypeEnum = pgEnum('account_type', [
  'project',
  'address',
  'drip_list',
  'linked_identity',
  'ecosystem_main_account',
  'sub_list',
]);
export const relationshipTypeEnum = pgEnum('relationship_type', [
  'project_maintainer',
  'project_dependency',
  'drip_list_receiver',
  'ecosystem_receiver',
  'sub_list_link',
  'sub_list_receiver',
  'identity_owner',
]);
export const linkedIdentityTypeEnum = pgEnum('linked_identity_types', ['orcid']);

// Core tables
export const cursor = pgTable('_cursor', {
  chain_id: text('chain_id').primaryKey(),
  fetched_to_block: bigint('fetched_to_block', { mode: 'bigint' }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const events = pgTable(
  '_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    chain_id: text('chain_id').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_hash: text('block_hash').notNull(),
    block_timestamp: timestamp('block_timestamp', { withTimezone: true }).notNull(),
    tx_index: integer('tx_index').notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    log_index: integer('log_index').notNull(),
    contract_address: text('contract_address').notNull(),
    event_name: text('event_name').notNull(),
    event_sig: text('event_sig').notNull(),
    args: jsonb('args').notNull(),
    status: eventStatusEnum('status').notNull().default('pending'),
    error_message: text('error_message'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    processed_at: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    unique().on(table.chain_id, table.block_number, table.tx_index, table.log_index),
    index('idx_events_chain_block').on(table.chain_id, table.block_number),
    index('idx_events_status')
      .on(table.status)
      .where(sql`status != 'processed'`),
    index('idx_events_signature').on(table.event_sig),
    index('idx_events_name').on(table.event_name),
  ],
);

export const blockHashes = pgTable(
  '_block_hashes',
  {
    chain_id: text('chain_id').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_hash: text('block_hash').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique().on(table.chain_id, table.block_number),
    index('idx_block_hashes_lookup').on(table.chain_id, table.block_number.desc()),
  ],
);

// Projects table.
export const projects = pgTable(
  'projects',
  {
    account_id: text('account_id').primaryKey(),
    name: text('name').notNull(),
    is_valid: boolean('is_valid').notNull(),
    is_visible: boolean('is_visible').notNull(),
    verification_status: projectStatusEnum('verification_status').notNull(),
    owner_address: text('owner_address'),
    owner_account_id: text('owner_account_id'),
    claimed_at: timestamp('claimed_at', { withTimezone: true }),
    url: text('url').notNull(),
    forge: forgeEnum('forge').notNull(),
    emoji: text('emoji'),
    color: text('color'),
    avatar_cid: text('avatar_cid'),
    last_processed_ipfs_hash: text('last_processed_ipfs_hash'),
    last_event_block: bigint('last_event_block', { mode: 'bigint' }),
    last_event_tx_index: integer('last_event_tx_index'),
    last_event_log_index: integer('last_event_log_index'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_projects_owner_address').on(table.owner_address),
    index('idx_projects_verification_status').on(table.verification_status),
    index('idx_projects_url').on(table.url),
    index('idx_projects_event_pointer').on(
      table.last_event_block,
      table.last_event_tx_index,
      table.last_event_log_index,
    ),
  ],
);

// Linked identities table.
export const linkedIdentities = pgTable(
  'linked_identities',
  {
    account_id: text('account_id').primaryKey(),
    identity_type: linkedIdentityTypeEnum('identity_type').notNull(),
    owner_address: text('owner_address'),
    owner_account_id: text('owner_account_id'),
    claimed_at: timestamp('claimed_at', { withTimezone: true }),
    last_processed_ipfs_hash: text('last_processed_ipfs_hash'),
    are_splits_valid: boolean('are_splits_valid').notNull(),
    is_visible: boolean('is_visible').notNull(),
    last_event_block: bigint('last_event_block', { mode: 'bigint' }),
    last_event_tx_index: integer('last_event_tx_index'),
    last_event_log_index: integer('last_event_log_index'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_linked_identities_owner_address').on(table.owner_address),
    index('idx_linked_identities_identity_type').on(table.identity_type),
    index('idx_linked_identities_event_pointer').on(
      table.last_event_block,
      table.last_event_tx_index,
      table.last_event_log_index,
    ),
  ],
);

// Drip lists table.
export const dripLists = pgTable(
  'drip_lists',
  {
    account_id: text('account_id').primaryKey(),
    is_valid: boolean('is_valid').notNull(),
    owner_address: text('owner_address').notNull(),
    owner_account_id: text('owner_account_id').notNull(),
    name: text('name'),
    latest_voting_round_id: uuid('latest_voting_round_id'),
    description: text('description'),
    creator: text('creator'),
    previous_owner_address: text('previous_owner_address'),
    is_visible: boolean('is_visible').notNull(),
    last_processed_ipfs_hash: text('last_processed_ipfs_hash'),
    last_event_block: bigint('last_event_block', { mode: 'bigint' }),
    last_event_tx_index: integer('last_event_tx_index'),
    last_event_log_index: integer('last_event_log_index'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_drip_lists_owner_address').on(table.owner_address),
    index('idx_drip_lists_event_pointer').on(
      table.last_event_block,
      table.last_event_tx_index,
      table.last_event_log_index,
    ),
  ],
);

// Ecosystem main accounts table.
export const ecosystemMainAccounts = pgTable(
  'ecosystem_main_accounts',
  {
    account_id: text('account_id').primaryKey(),
    is_valid: boolean('is_valid').notNull(),
    owner_address: text('owner_address').notNull(),
    owner_account_id: text('owner_account_id').notNull(),
    name: text('name'),
    description: text('description'),
    creator: text('creator'),
    previous_owner_address: text('previous_owner_address'),
    is_visible: boolean('is_visible').notNull(),
    last_processed_ipfs_hash: text('last_processed_ipfs_hash').notNull(),
    avatar: text('avatar').notNull(),
    color: text('color').notNull(),
    last_event_block: bigint('last_event_block', { mode: 'bigint' }),
    last_event_tx_index: integer('last_event_tx_index'),
    last_event_log_index: integer('last_event_log_index'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_ecosystem_main_accounts_owner_address').on(table.owner_address),
    index('idx_ecosystem_main_accounts_event_pointer').on(
      table.last_event_block,
      table.last_event_tx_index,
      table.last_event_log_index,
    ),
  ],
);

// Sub lists table.
export const subLists = pgTable(
  'sub_lists',
  {
    account_id: text('account_id').primaryKey(),
    is_valid: boolean('is_valid').notNull(),
    parent_account_id: text('parent_account_id').notNull(),
    parent_account_type: accountTypeEnum('parent_account_type').notNull(),
    root_account_id: text('root_account_id').notNull(),
    root_account_type: accountTypeEnum('root_account_type').notNull(),
    last_processed_ipfs_hash: text('last_processed_ipfs_hash').notNull(),
    last_event_block: bigint('last_event_block', { mode: 'bigint' }),
    last_event_tx_index: integer('last_event_tx_index'),
    last_event_log_index: integer('last_event_log_index'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_sub_lists_parent').on(table.parent_account_id),
    index('idx_sub_lists_root').on(table.root_account_id),
    index('idx_sub_lists_event_pointer').on(
      table.last_event_block,
      table.last_event_tx_index,
      table.last_event_log_index,
    ),
  ],
);

// Pending NFT transfers table.
export const pendingNftTransfers = pgTable(
  '_pending_nft_transfers',
  {
    account_id: text('account_id').primaryKey(),
    owner_address: text('owner_address').notNull(),
    owner_account_id: text('owner_account_id').notNull(),
    creator: text('creator'),
    previous_owner_address: text('previous_owner_address'),
    is_visible: boolean('is_visible').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    last_event_block: bigint('last_event_block', { mode: 'bigint' }),
    last_event_tx_index: integer('last_event_tx_index'),
    last_event_log_index: integer('last_event_log_index'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx__pending_nft_transfers_block_number').on(table.block_number),
    index('idx__pending_nft_transfers_event_pointer').on(
      table.last_event_block,
      table.last_event_tx_index,
      table.last_event_log_index,
    ),
  ],
);

// Splits receivers table.
export const splitsReceivers = pgTable(
  'splits_receivers',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    receiver_account_id: text('receiver_account_id').notNull(),
    receiver_account_type: accountTypeEnum('receiver_account_type').notNull(),
    sender_account_id: text('sender_account_id').notNull(),
    sender_account_type: accountTypeEnum('sender_account_type').notNull(),
    relationship_type: relationshipTypeEnum('relationship_type').notNull(),
    weight: integer('weight').notNull(),
    block_timestamp: timestamp('block_timestamp', { withTimezone: true }).notNull(),
    splits_to_repo_driver_sub_account: boolean('splits_to_repo_driver_sub_account'),
    last_event_block: bigint('last_event_block', { mode: 'bigint' }),
    last_event_tx_index: integer('last_event_tx_index'),
    last_event_log_index: integer('last_event_log_index'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique().on(table.sender_account_id, table.receiver_account_id, table.relationship_type),
    index('idx_splits_receivers_receiver_sender').on(
      table.receiver_account_id,
      table.sender_account_id,
    ),
    index('idx_splits_receivers_sender_receiver').on(
      table.sender_account_id,
      table.receiver_account_id,
    ),
    index('idx_splits_receivers_sender').on(table.sender_account_id),
    index('idx_splits_receivers_event_pointer').on(
      table.last_event_block,
      table.last_event_tx_index,
      table.last_event_log_index,
    ),
  ],
);

// Given events table.
export const givenEvents = pgTable(
  'given_events',
  {
    account_id: text('account_id').notNull(),
    receiver: text('receiver').notNull(),
    erc20: text('erc20').notNull(),
    amt: text('amt').notNull(),
    log_index: integer('log_index').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_timestamp: timestamp('block_timestamp', { withTimezone: true }).notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique().on(table.transaction_hash, table.log_index),
    index('idx_given_events_account_id').on(table.account_id),
    index('idx_given_events_receiver').on(table.receiver),
    index('idx_given_events_erc20').on(table.erc20),
  ],
);

// Split events table.
export const splitEvents = pgTable(
  'split_events',
  {
    account_id: text('account_id').notNull(),
    receiver: text('receiver').notNull(),
    erc20: text('erc20').notNull(),
    amt: text('amt').notNull(),
    log_index: integer('log_index').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_timestamp: timestamp('block_timestamp', { withTimezone: true }).notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique().on(table.transaction_hash, table.log_index),
    index('idx_split_events_receiver').on(table.receiver),
    index('idx_split_events_account_id_receiver').on(table.account_id, table.receiver),
  ],
);

// Squeezed streams events table.
export const squeezedStreamsEvents = pgTable(
  'squeezed_streams_events',
  {
    account_id: text('account_id').notNull(),
    erc20: text('erc20').notNull(),
    sender_id: text('sender_id').notNull(),
    amount: text('amount').notNull(),
    streams_history_hashes: text('streams_history_hashes').notNull(),
    log_index: integer('log_index').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_timestamp: timestamp('block_timestamp', { withTimezone: true }).notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique().on(table.transaction_hash, table.log_index)],
);

// Streams set events table.
export const streamsSetEvents = pgTable(
  'streams_set_events',
  {
    account_id: text('account_id').notNull(),
    erc20: text('erc20').notNull(),
    receivers_hash: text('receivers_hash').notNull(),
    streams_history_hash: text('streams_history_hash').notNull(),
    balance: text('balance').notNull(),
    max_end: text('max_end').notNull(),
    log_index: integer('log_index').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_timestamp: timestamp('block_timestamp', { withTimezone: true }).notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique().on(table.transaction_hash, table.log_index),
    index('idx_streams_set_events_receivers_hash').on(table.receivers_hash),
    index('idx_streams_set_events_account_id').on(table.account_id),
  ],
);

// Account metadata emitted events table.
export const accountMetadataEmittedEvents = pgTable(
  'account_metadata_emitted_events',
  {
    key: text('key').notNull(),
    value: text('value').notNull(),
    account_id: text('account_id').notNull(),
    log_index: integer('log_index').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_timestamp: timestamp('block_timestamp', { withTimezone: true }).notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique().on(table.transaction_hash, table.log_index),
    index('idx_account_metadata_emitted_events_account_id').on(table.account_id),
  ],
);

// Stream receiver seen events table.
export const streamReceiverSeenEvents = pgTable(
  'stream_receiver_seen_events',
  {
    account_id: text('account_id').notNull(),
    config: text('config').notNull(),
    receivers_hash: text('receivers_hash').notNull(),
    log_index: integer('log_index').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_timestamp: timestamp('block_timestamp', { withTimezone: true }).notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique().on(table.transaction_hash, table.log_index),
    index('idx_stream_receiver_seen_events_account_id').on(table.account_id),
  ],
);

// Splits set events table.
export const splitsSetEvents = pgTable(
  'splits_set_events',
  {
    account_id: text('account_id').notNull(),
    receivers_hash: text('receivers_hash').notNull(),
    log_index: integer('log_index').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_timestamp: timestamp('block_timestamp', { withTimezone: true }).notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique().on(table.transaction_hash, table.log_index),
    index('idx_splits_set_events_account_id').on(table.account_id),
    index('idx_splits_set_events_receivers_hash').on(table.receivers_hash),
  ],
);

// Transfer events table.
export const transferEvents = pgTable(
  'transfer_events',
  {
    from: text('from').notNull(),
    to: text('to').notNull(),
    token_id: text('token_id').notNull(),
    log_index: integer('log_index').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_timestamp: timestamp('block_timestamp', { withTimezone: true }).notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique().on(table.transaction_hash, table.log_index),
    index('idx_transfer_events_from').on(table.from),
    index('idx_transfer_events_to').on(table.to),
    index('idx_transfer_events_token_id').on(table.token_id),
  ],
);
