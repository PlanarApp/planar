ALTER TABLE "github_repos" ADD COLUMN "hook_id" bigint;--> statement-breakpoint
ALTER TABLE "github_repos" ADD COLUMN "hook_secret_enc" text;--> statement-breakpoint
ALTER TABLE "github_repos" ADD COLUMN "hook_error" text;