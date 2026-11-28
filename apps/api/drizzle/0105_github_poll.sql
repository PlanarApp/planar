-- PLNRAPP-893: the GitHub poller's state — the per-token rate-limit deferral and the per-binding cursor
ALTER TABLE "github_connections" ADD COLUMN "deferred_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "github_repos" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "github_repos" ADD COLUMN "prs_etag" text;--> statement-breakpoint
ALTER TABLE "github_repos" ADD COLUMN "commits_etag" text;--> statement-breakpoint
ALTER TABLE "github_repos" ADD COLUMN "last_polled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "github_repos" ADD COLUMN "last_error" text;