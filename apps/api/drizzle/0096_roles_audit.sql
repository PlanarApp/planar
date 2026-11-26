-- Roles audit 2026-11-26 (docs/contracts/core.md, «Roles and access»).
-- 1) A role in a space or a project is capped by the instance role: an instance guest is at most a guest.
--    Existing rows are brought to the cap (a space may be left without an admin: instance admins administer every space).
UPDATE "space_members" sm SET "role" = 'guest', "updated_at" = now()
  FROM "users" u WHERE u."id" = sm."user_id" AND u."role" = 'guest' AND sm."role" <> 'guest';--> statement-breakpoint
UPDATE "project_members" pm SET "role" = 'guest', "updated_at" = now()
  FROM "users" u WHERE u."id" = pm."user_id" AND u."role" = 'guest' AND pm."role" <> 'guest';--> statement-breakpoint
-- 3) Instance owners and admins see every space: the one rule of space visibility (module SQL uses it too).
CREATE FUNCTION can_see_space(p_user uuid, p_space uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM space_members WHERE space_id = p_space AND user_id = p_user)
      OR EXISTS (SELECT 1 FROM users WHERE id = p_user AND role IN ('owner', 'admin'))
$$;--> statement-breakpoint
-- a global _reset: every client re-bootstraps (roles changed, instance admins get all spaces)
INSERT INTO "changes" (entity, id, op) VALUES ('_reset', 'roles-audit-2026-11-26', 'put');
