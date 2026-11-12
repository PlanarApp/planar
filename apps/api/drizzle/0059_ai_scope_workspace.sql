-- PLNRAPP-193: уровень подключения ИИ instance переименован в workspace (как уровни групп в ядре)
UPDATE "ai_connections" SET "scope" = 'workspace' WHERE "scope" = 'instance';
