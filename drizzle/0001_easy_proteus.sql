CREATE TABLE "anon_rate_counters" (
	"bucket" text NOT NULL,
	"window_key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "anon_rate_counters_bucket_window_key_pk" PRIMARY KEY("bucket","window_key")
);
--> statement-breakpoint
CREATE INDEX "oauth_tokens_parent_idx" ON "oauth_tokens" USING btree ("parent_hash");