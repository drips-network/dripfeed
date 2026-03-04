CREATE TABLE "watched_givers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"giver_address" text NOT NULL,
	"token_address" text NOT NULL,
	"chain_id" text NOT NULL,
	"webhook_url" text NOT NULL,
	"metadata" jsonb,
	"last_known_balance" text DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watched_givers_giver_address_token_address_chain_id_unique" UNIQUE("giver_address","token_address","chain_id")
);
--> statement-breakpoint
CREATE INDEX "idx_watched_givers_active" ON "watched_givers" USING btree ("is_active") WHERE is_active = true;