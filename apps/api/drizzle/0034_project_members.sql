CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"space_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_role_check" CHECK ("project_members"."role" in ('admin', 'member', 'guest'))
);
--> statement-breakpoint
ALTER TABLE "changes" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "members_mode" text DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_project_id_user_id_index" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_members_user_id_index" ON "project_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_members_mode_check" CHECK ("projects"."members_mode" in ('inherit', 'custom'));--> statement-breakpoint
-- PJ-11: the one rule of project access (docs/contracts/projects.md §PJ-11); null — no access.
-- Instance admins and space admins are always admins of every project of the space (assumption of the coordinator);
-- inherit — the role in space_members; custom — the role in project_members, a space guest is at most a guest.
-- Used by the API (apps/api/src/sync/project-access.ts) and by module SQL: no per-site copies of the rule.
-- Delivery to clients: no data moves (all projects are inherit); a global _reset at the end makes every client
-- re-bootstrap and receive the new entity projectMembers and projects.membersMode (as in 0033).
CREATE FUNCTION project_role(p_user uuid, p_project uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN u.role IN ('owner', 'admin') THEN 'admin'
    WHEN sm.role IS NULL THEN NULL
    WHEN sm.role = 'admin' THEN 'admin'
    WHEN pr.members_mode = 'inherit' THEN sm.role
    WHEN pm.role IS NULL THEN NULL
    WHEN sm.role = 'guest' THEN 'guest'
    ELSE pm.role
  END
  FROM projects pr
  LEFT JOIN users u ON u.id = p_user
  LEFT JOIN space_members sm ON sm.space_id = pr.space_id AND sm.user_id = p_user
  LEFT JOIN project_members pm ON pm.project_id = pr.id AND pm.user_id = p_user
  WHERE pr.id = p_project
$$;--> statement-breakpoint
INSERT INTO "changes" (entity, id, op) VALUES ('_reset', 'pj-11-project-members', 'put');
