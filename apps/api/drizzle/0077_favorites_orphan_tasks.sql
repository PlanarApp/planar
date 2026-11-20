-- PLNRAPP-700: favourites of tasks deleted before the fix (refId has no FK)
DELETE FROM "favorites" f
WHERE f."kind" = 'task'
  AND NOT EXISTS (SELECT 1 FROM "tasks" t WHERE t."id"::text = f."ref_id");
