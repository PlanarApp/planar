ALTER TABLE "user_security" ADD COLUMN "lock_on_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "user_security" SET "lock_on_open" = true, "lock_minutes" = NULL WHERE "lock_minutes" = 0;
