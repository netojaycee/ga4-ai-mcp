CREATE TABLE "deleted_accounts" (
	"sub_hash" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_valid_after" timestamp with time zone;