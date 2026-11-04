ALTER TABLE "projects" ADD COLUMN "default_assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_default_assignee_id_users_id_fk" FOREIGN KEY ("default_assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_lead_id_users_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- PLANARAPP-3/4: the new fields reach clients only with a re-bootstrap (as in 0033, 0034)
INSERT INTO "changes" (entity, id, op) VALUES ('_reset', 'planarapp-3-4-leads', 'put');