set -e
cd /root/planar-features
D=.dpcli/dpcli
WEBDT=(--dont-touch "apps/web/src/sync/, apps/web/src/tasks/, apps/web/src/views/list/, e2e/web/perf/ — WB-18 модуля web" --dont-touch "apps/web/src/__contract__/, apps/web/src/contract.ts — контрактные тесты, правит координатор" --dont-touch "packages/, apps/api/ — core (FT-1a уже в ветке)" --dont-touch "package.json, pnpm-lock.yaml — без новых зависимостей" --dont-touch "docs/, .claude/, CLAUDE.md")
WEBCK=(--check install "pnpm install --frozen-lockfile" "exit=0" --check typecheck "pnpm --filter web exec vue-tsc --noEmit" "exit=0" --check lint "pnpm exec eslint apps/web && pnpm exec prettier --check apps/web" "exit=0" --check size "pnpm --filter web build >/dev/null && node apps/web/scripts/size.mjs" "exit=0")

$D task new features FT-1b --type dp-engineer \
 --title "Пользовательские поля в интерфейсе: блок в карточке, настройка полей проекта, фильтры" \
 --goal "В карточке задачи есть блок «Поля» с правкой значений всех 7 типов и диалог настройки полей проекта; фильтр сохранённых видов умеет правила по полям (F-filter); экспорты apps/web/src/fields/index.ts по F-fields." \
 --plan-ref "5. Задачи" --contract F-fields@1 --contract F-filter@1 --contract C-views@2 --contract C-tasks@2 --contract C-ui@1 --contract C-mutators@3 \
 --scope apps/web/src/fields/ --scope apps/web/src/task/TaskDetail.vue --scope apps/web/src/views/filter.ts --scope apps/web/src/views/saved/ --scope apps/web/src/views/__tests__/ --scope apps/web/src/i18n/ru.ts --scope apps/web/src/i18n/en.ts --scope build/dpcli/FT-1b.report.json \
 "${WEBDT[@]}" --dont-touch "apps/web/src/links/, views/board/ — FT-4a; views/table/ — FT-2b" \
 "${WEBCK[@]}" \
 --check test "pnpm --filter web exec vitest run --exclude src/__contract__/links.contract.test.ts" "exit=0" \
 --check contract "pnpm --filter web exec vitest run src/__contract__/fields.contract.test.ts" 'num:Tests\s+(\d+) passed >=13' \
 --check fields_ui "pnpm --filter web exec vitest run src/fields src/views -t 'fields-ui:'" 'num:Tests\s+(\d+) passed >=8'

$D task new features FT-4a --type dp-engineer \
 --title "Связи задач в интерфейсе: блок в карточке, поиск задачи, иконка «заблокирована» на Доске" \
 --goal "В карточке задачи есть блок «Связи» (4 вида, обратная сторона вычисляется) с поиском задачи для связи и удалением; на Доске заблокированные задачи помечены иконкой; экспорты apps/web/src/links/index.ts по F-links." \
 --plan-ref "5. Задачи" --contract F-links@1 --contract C-tasks@2 --contract C-views@2 --contract C-ui@1 --contract C-mutators@3 \
 --scope apps/web/src/links/ --scope apps/web/src/task/TaskDetail.vue --scope apps/web/src/views/board/ --scope apps/web/src/i18n/ru.ts --scope apps/web/src/i18n/en.ts --scope build/dpcli/FT-4a.report.json \
 "${WEBDT[@]}" --dont-touch "apps/web/src/fields/, views/filter.ts, views/saved/ — FT-1b; views/list/ — иконка в Списке после WB-18 (FT-4b)" \
 "${WEBCK[@]}" \
 --check test "pnpm --filter web exec vitest run --exclude src/__contract__/fields.contract.test.ts" "exit=0" \
 --check contract "pnpm --filter web exec vitest run src/__contract__/links.contract.test.ts" 'num:Tests\s+(\d+) passed >=6' \
 --check links_ui "pnpm --filter web exec vitest run src/links src/views/board -t 'links-ui:'" 'num:Tests\s+(\d+) passed >=7'

$D task new features FT-1c --type dp-engineer \
 --title "Пользовательские поля в REST v1 и MCP" \
 --goal "REST v1 отдаёт определения полей проекта и принимает fields в PATCH задачи, MCP — list_fields и fields в update_task, по C-http v8; ошибки валидации — 400 invalid_request / isError." \
 --plan-ref "5. Задачи" --contract C-http@8 --contract C-mutators@3 --contract F-fields@1 \
 --scope apps/api/src/rest/ --scope apps/api/src/mcp/ --scope apps/api/test/rest/ --scope apps/api/test/mcp/ --scope docs/guides/mcp.md --scope build/dpcli/FT-1c.report.json \
 --dont-touch "packages/shared/ — мутаторы и схемы уже есть (FT-1a); нужна правка — «FT-1c contract: …»" \
 --dont-touch "apps/api/src/db/, apps/api/drizzle/, apps/api/src/sync/" \
 --dont-touch "apps/web/" --dont-touch "docs/contracts/ — правит координатор" \
 --dont-touch "package.json, pnpm-lock.yaml" --dont-touch ".claude/, CLAUDE.md" \
 --check lint "pnpm install --frozen-lockfile && pnpm exec eslint packages apps/api && pnpm exec prettier --check packages apps/api" "exit=0" \
 --check build "pnpm -r build" "exit=0" \
 --check testdb "./dev.sh testdb" "exit=0" \
 --check contract "pnpm exec vitest run packages/shared/test/contract.test.ts apps/api/test/contract.schema.test.ts" "exit=0" \
 --check api_fields "pnpm exec vitest run apps/api/test/rest apps/api/test/mcp -t 'fields:'" 'num:Tests\s+(\d+) passed >=6' \
 --check test "pnpm test" "exit=0"
