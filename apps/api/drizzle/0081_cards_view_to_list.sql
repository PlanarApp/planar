-- PLNRAPP-707: the view «Cards» is removed — saved views with layout 'cards' open as the List.
-- Named views (node IS NULL; personal and shared) get layout 'list'. A node tab row (node IS NOT NULL —
-- one per node, layout and user, userId NULL — the shared default) becomes the List row of its node,
-- unless the node already has a List row of the same user: then the Cards row is dropped, the List
-- row stays. A repeated run changes nothing. Clients get the rows with a re-bootstrap (_reset, as in
-- 0078) — only when something was changed.
WITH "dup" AS (
  DELETE FROM "saved_views" c
  WHERE c."layout" = 'cards' AND c."node" IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "saved_views" l
      WHERE l."layout" = 'list' AND l."node" = c."node"
        AND l."user_id" IS NOT DISTINCT FROM c."user_id"
    )
  RETURNING c."id"
), "upd" AS (
  UPDATE "saved_views" v
  SET "layout" = 'list',
      "name" = CASE WHEN v."node" IS NOT NULL AND v."name" = 'cards' THEN 'list' ELSE v."name" END,
      "updated_at" = now()
  WHERE v."layout" = 'cards' AND v."id" NOT IN (SELECT "id" FROM "dup")
  RETURNING v."id"
)
INSERT INTO "changes" (entity, id, op)
SELECT '_reset', 'plnrapp-707-cards-view-to-list', 'put'
WHERE EXISTS (SELECT 1 FROM "dup") OR EXISTS (SELECT 1 FROM "upd");
