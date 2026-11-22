-- PLNRAPP-709: «My day» works on tasks.due_date; the personal plan table is dropped.
-- Its dates were moved to tasks.due_date by 0078. Old `changes` rows of the entity dayPlans stay:
-- pull sends only entities of ENTITIES, and dayPlans is not among them (C-schema v31).
DROP TABLE IF EXISTS "day_plans";
