CREATE TYPE account_type AS ENUM('project', 'address', 'drip_list', 'linked_identity', 'ecosystem_main_account', 'sub_list');--> statement-breakpoint
CREATE TYPE status AS ENUM('pending', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE forges AS ENUM('github', 'gitlab');--> statement-breakpoint
CREATE TYPE linked_identity_types AS ENUM('orcid');--> statement-breakpoint
CREATE TYPE verification_status AS ENUM('claimed', 'unclaimed', 'pending_metadata');--> statement-breakpoint
CREATE TYPE relationship_type AS ENUM('project_maintainer', 'project_dependency', 'drip_list_receiver', 'ecosystem_receiver', 'sub_list_link', 'sub_list_receiver', 'identity_owner');--> statement-breakpoint
CREATE TABLE "account_metadata_emitted_events" (
	"key" text NOT NULL,
	"value" text NOT NULL,
	"account_id" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"transaction_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_metadata_emitted_events_transaction_hash_log_index_unique" UNIQUE("transaction_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "_block_hashes" (
	"chain_id" text NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "_block_hashes_chain_id_block_number_unique" UNIQUE("chain_id","block_number")
);
--> statement-breakpoint
CREATE TABLE "_cursor" (
	"chain_id" text PRIMARY KEY NOT NULL,
	"fetched_to_block" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drip_lists" (
	"account_id" text PRIMARY KEY NOT NULL,
	"is_valid" boolean NOT NULL,
	"owner_address" text NOT NULL,
	"owner_account_id" text NOT NULL,
	"name" text,
	"latest_voting_round_id" uuid,
	"description" text,
	"creator" text,
	"previous_owner_address" text,
	"is_visible" boolean NOT NULL,
	"last_processed_ipfs_hash" text,
	"last_event_block" bigint,
	"last_event_tx_index" integer,
	"last_event_log_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ecosystem_main_accounts" (
	"account_id" text PRIMARY KEY NOT NULL,
	"is_valid" boolean NOT NULL,
	"owner_address" text NOT NULL,
	"owner_account_id" text NOT NULL,
	"name" text,
	"description" text,
	"creator" text,
	"previous_owner_address" text,
	"is_visible" boolean NOT NULL,
	"last_processed_ipfs_hash" text NOT NULL,
	"avatar" text NOT NULL,
	"color" text NOT NULL,
	"last_event_block" bigint,
	"last_event_tx_index" integer,
	"last_event_log_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" text NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"tx_index" integer NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"contract_address" text NOT NULL,
	"event_name" text NOT NULL,
	"event_sig" text NOT NULL,
	"args" jsonb NOT NULL,
	"status" "status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "_events_chain_id_block_number_tx_index_log_index_unique" UNIQUE("chain_id","block_number","tx_index","log_index")
);
--> statement-breakpoint
CREATE TABLE "given_events" (
	"account_id" text NOT NULL,
	"receiver" text NOT NULL,
	"erc20" text NOT NULL,
	"amt" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"transaction_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "given_events_transaction_hash_log_index_unique" UNIQUE("transaction_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "linked_identities" (
	"account_id" text PRIMARY KEY NOT NULL,
	"identity_type" "linked_identity_types" NOT NULL,
	"owner_address" text,
	"owner_account_id" text,
	"claimed_at" timestamp with time zone,
	"last_processed_ipfs_hash" text,
	"are_splits_valid" boolean NOT NULL,
	"is_visible" boolean NOT NULL,
	"last_event_block" bigint,
	"last_event_tx_index" integer,
	"last_event_log_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "_pending_nft_transfers" (
	"account_id" text PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"owner_account_id" text NOT NULL,
	"creator" text,
	"previous_owner_address" text,
	"is_visible" boolean NOT NULL,
	"block_number" bigint NOT NULL,
	"last_event_block" bigint,
	"last_event_tx_index" integer,
	"last_event_log_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"account_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_valid" boolean NOT NULL,
	"is_visible" boolean NOT NULL,
	"verification_status" "verification_status" NOT NULL,
	"owner_address" text,
	"owner_account_id" text,
	"claimed_at" timestamp with time zone,
	"url" text,
	"forge" "forges" NOT NULL,
	"emoji" text,
	"color" text,
	"avatar_cid" text,
	"last_processed_ipfs_hash" text,
	"last_event_block" bigint,
	"last_event_tx_index" integer,
	"last_event_log_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "split_events" (
	"account_id" text NOT NULL,
	"receiver" text NOT NULL,
	"erc20" text NOT NULL,
	"amt" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"transaction_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "split_events_transaction_hash_log_index_unique" UNIQUE("transaction_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "splits_receivers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"receiver_account_id" text NOT NULL,
	"receiver_account_type" "account_type" NOT NULL,
	"sender_account_id" text NOT NULL,
	"sender_account_type" "account_type" NOT NULL,
	"relationship_type" "relationship_type" NOT NULL,
	"weight" integer NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"splits_to_repo_driver_sub_account" boolean,
	"last_event_block" bigint,
	"last_event_tx_index" integer,
	"last_event_log_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "splits_receivers_sender_account_id_receiver_account_id_relationship_type_unique" UNIQUE("sender_account_id","receiver_account_id","relationship_type")
);
--> statement-breakpoint
CREATE TABLE "splits_set_events" (
	"account_id" text NOT NULL,
	"receivers_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"transaction_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "splits_set_events_transaction_hash_log_index_unique" UNIQUE("transaction_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "squeezed_streams_events" (
	"account_id" text NOT NULL,
	"erc20" text NOT NULL,
	"sender_id" text NOT NULL,
	"amount" text NOT NULL,
	"streams_history_hashes" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"transaction_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "squeezed_streams_events_transaction_hash_log_index_unique" UNIQUE("transaction_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "stream_receiver_seen_events" (
	"account_id" text NOT NULL,
	"config" text NOT NULL,
	"receivers_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"transaction_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stream_receiver_seen_events_transaction_hash_log_index_unique" UNIQUE("transaction_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "streams_set_events" (
	"account_id" text NOT NULL,
	"erc20" text NOT NULL,
	"receivers_hash" text NOT NULL,
	"streams_history_hash" text NOT NULL,
	"balance" text NOT NULL,
	"max_end" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"transaction_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "streams_set_events_transaction_hash_log_index_unique" UNIQUE("transaction_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "sub_lists" (
	"account_id" text PRIMARY KEY NOT NULL,
	"is_valid" boolean NOT NULL,
	"parent_account_id" text NOT NULL,
	"parent_account_type" "account_type" NOT NULL,
	"root_account_id" text NOT NULL,
	"root_account_type" "account_type" NOT NULL,
	"last_processed_ipfs_hash" text NOT NULL,
	"last_event_block" bigint,
	"last_event_tx_index" integer,
	"last_event_log_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_account_metadata_emitted_events_account_id" ON "account_metadata_emitted_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_block_hashes_lookup" ON "_block_hashes" USING btree ("chain_id","block_number" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_drip_lists_owner_address" ON "drip_lists" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "idx_drip_lists_event_pointer" ON "drip_lists" USING btree ("last_event_block","last_event_tx_index","last_event_log_index");--> statement-breakpoint
CREATE INDEX "idx_ecosystem_main_accounts_owner_address" ON "ecosystem_main_accounts" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "idx_ecosystem_main_accounts_event_pointer" ON "ecosystem_main_accounts" USING btree ("last_event_block","last_event_tx_index","last_event_log_index");--> statement-breakpoint
CREATE INDEX "idx_events_chain_block" ON "_events" USING btree ("chain_id","block_number");--> statement-breakpoint
CREATE INDEX "idx_events_status" ON "_events" USING btree ("status") WHERE status != 'processed';--> statement-breakpoint
CREATE INDEX "idx_events_signature" ON "_events" USING btree ("event_sig");--> statement-breakpoint
CREATE INDEX "idx_events_name" ON "_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "idx_given_events_account_id" ON "given_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_given_events_receiver" ON "given_events" USING btree ("receiver");--> statement-breakpoint
CREATE INDEX "idx_given_events_erc20" ON "given_events" USING btree ("erc20");--> statement-breakpoint
CREATE INDEX "idx_linked_identities_owner_address" ON "linked_identities" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "idx_linked_identities_identity_type" ON "linked_identities" USING btree ("identity_type");--> statement-breakpoint
CREATE INDEX "idx_linked_identities_event_pointer" ON "linked_identities" USING btree ("last_event_block","last_event_tx_index","last_event_log_index");--> statement-breakpoint
CREATE INDEX "idx__pending_nft_transfers_block_number" ON "_pending_nft_transfers" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX "idx__pending_nft_transfers_event_pointer" ON "_pending_nft_transfers" USING btree ("last_event_block","last_event_tx_index","last_event_log_index");--> statement-breakpoint
CREATE INDEX "idx_projects_owner_address" ON "projects" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "idx_projects_verification_status" ON "projects" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "idx_projects_url" ON "projects" USING btree ("url");--> statement-breakpoint
CREATE INDEX "idx_projects_event_pointer" ON "projects" USING btree ("last_event_block","last_event_tx_index","last_event_log_index");--> statement-breakpoint
CREATE INDEX "idx_split_events_receiver" ON "split_events" USING btree ("receiver");--> statement-breakpoint
CREATE INDEX "idx_split_events_account_id_receiver" ON "split_events" USING btree ("account_id","receiver");--> statement-breakpoint
CREATE INDEX "idx_splits_receivers_receiver_sender" ON "splits_receivers" USING btree ("receiver_account_id","sender_account_id");--> statement-breakpoint
CREATE INDEX "idx_splits_receivers_sender_receiver" ON "splits_receivers" USING btree ("sender_account_id","receiver_account_id");--> statement-breakpoint
CREATE INDEX "idx_splits_receivers_sender" ON "splits_receivers" USING btree ("sender_account_id");--> statement-breakpoint
CREATE INDEX "idx_splits_receivers_event_pointer" ON "splits_receivers" USING btree ("last_event_block","last_event_tx_index","last_event_log_index");--> statement-breakpoint
CREATE INDEX "idx_splits_set_events_account_id" ON "splits_set_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_splits_set_events_receivers_hash" ON "splits_set_events" USING btree ("receivers_hash");--> statement-breakpoint
CREATE INDEX "idx_stream_receiver_seen_events_account_id" ON "stream_receiver_seen_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_streams_set_events_receivers_hash" ON "streams_set_events" USING btree ("receivers_hash");--> statement-breakpoint
CREATE INDEX "idx_streams_set_events_account_id" ON "streams_set_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_sub_lists_parent" ON "sub_lists" USING btree ("parent_account_id");--> statement-breakpoint
CREATE INDEX "idx_sub_lists_root" ON "sub_lists" USING btree ("root_account_id");--> statement-breakpoint
CREATE INDEX "idx_sub_lists_event_pointer" ON "sub_lists" USING btree ("last_event_block","last_event_tx_index","last_event_log_index");