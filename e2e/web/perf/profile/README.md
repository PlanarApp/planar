# WB-17 — профилирование бюджетов §7 (прод-сборка web, Chromium)

Вывод — `summary.md`, подробный разбор по стадиям — `breakdown.md` (копия `build/artifacts/WB-17/breakdown.md`).

## Воспроизведение

Нужны Docker, pnpm, `pnpm install --offline --frozen-lockfile` в корне копии. Порты не пересекаются с WB-15 (`env.sh`: API 3217, WEB 5317, PG 55517).

```bash
bash e2e/web/perf/profile/up.sh sourcemap     # reset + seed --tasks 10000, vite build --sourcemap, vite preview :5317 (стек остаётся)
# дальше всё под замком CPU:
.dpcli/dpcli lock cpu wb17 -- bash e2e/web/perf/profile/full.sh <метка>   # пересборка, mutate+stages+idb-micro, затем CPU-профили (PROF=1) и разбор по исходникам
python3 e2e/web/perf/profile/stages.py base2 final      # таблицы стадий (results/stage-tables.md)
python3 e2e/web/perf/profile/effects.py                 # сводка эффекта по сборкам (results/effects.md)
bash e2e/web/perf/profile/down.sh                       # остановить и удалить стек
```

Прототипы — только в рабочей копии `apps/web/src`, не в коммите. Патчи по порядку (каждый поверх предыдущих, цепочка проверена на чистом HEAD):
`patches/P1-links-getall`, `P2-push-first`, `P6-memory-store`, `P7-keepalive-preload` (+P9 preload), `P10-no-readonly-proxy`, `P4-shared-dictionaries`,
`P11-lazy-popover`, `P8-priority-bootstrap`, `P12-idle-prefetch`; `ALL-P1-P12.patch` — всё разом; `rejected-*` — отвергнутые (P3 параллельные чтения, P13 overscan).
Применить: `git apply e2e/web/perf/profile/patches/ALL-P1-P12.patch` (затем `bash e2e/web/perf/profile/rebuild.sh`).
Метка сборки в `results/<метка>/`: `base2` — база, `P1`, `P1P2`, `P1P2P6`, `P1P2P6P7P9`, `…P10`, `…P4`, `P11test`, `P8test`, `P12test`, `final` — накопленные патчи.

## Файлы

| файл | что |
|---|---|
| `lib.ts` | инструментация страницы (`instrument()`: транзакции IDB, fetch, WS, long-animation-frame), контекст, CDP-профайлер, правка названия |
| `mutate.spec.ts`, `stages.spec.ts` | сценарии mutate / cold / warm / switch / realtime (`PROF=1` — с CPU-профилем, `LABEL=<метка>` — каталог результатов) |
| `idb-micro.spec.ts` | пол сырого IndexedDB без Dexie/Vue (чтение/запись) |
| `analyze.mjs` | разбор `.cpuprofile` по исходным файлам через sourcemap `dist/assets/*.map` (профиль и `dist` должны быть от одной сборки) |
| `stages.py`, `effects.py` | таблицы стадий и эффекта по результатам |
| `up.sh`, `rebuild.sh`, `down.sh`, `runall.sh`, `bench.sh`, `full.sh`, `env.sh` | стенд и запуск (копия логики `../run.sh` WB-15, не меняя её) |
| `results/<метка>/*.json` | числа и таймлайны (`*-prof.json` — прогон с профайлером; `cpu-*.json` — разбор профиля) |
| `patches/` | прототипы правок |

Сырые `.cpuprofile` (десятки МБ) — только локально: `build/wb17-raw/<метка>/` (не в git).

## Что и чем мерено

- Тот же сценарий, что WB-15 (`../measure.spec.ts`): сид 10 000 задач, проект PLN (3334), входы `admin`/`alice`; Chromium из Playwright 1.60, headless, прод-сборка (`vite build`, PWA) через `vite preview`, API/Postgres — `compose.dev.yml`.
- Стадии — по событиям страницы (`IDBDatabase.transaction` с `complete`, обёртка `fetch`/`Response.json`, `WebSocket`-сообщения, `PerformanceObserver('long-animation-frame')`), время `performance.now()`, между вкладками — `performance.timeOrigin`.
- CPU — `Profiler` CDP, интервал 1 мс, отдельный прогон (в замерах времени профайлер выключен).
- В `lib.ts` слушатели правки ставятся и дожидаются до нажатия Enter: инструмент WB-15 при правке быстрее ~30 мс может зависнуть (Enter обгоняет `page.evaluate`).
- Серверные числа для сравнения — `pnpm --filter @planar/e2e measure` (CR-9): `bootstrap_ms=378`, `pull_ms=15`, `push_ms_p95=24`, `poke_ms_p95=50`; ответ bootstrap 8 143 051 байт (gzip 717 638).

## Источники и лицензии

Данные — синтетический сид проекта (`./dev.sh seed --tasks 10000`), внешних данных нет. Использованы библиотеки проекта (Dexie 4.4.6 — Apache-2.0, Vue 3.5, zod, reka-ui — MIT) и Playwright (Apache-2.0); `source-map-js` (BSD-3-Clause) из дерева зависимостей pnpm для разбора профилей.
Литература не использовалась; поведение Dexie проверено по исходнику `node_modules/.pnpm/dexie@4.4.6/.../dist/dexie.js` (`cacheMiddleware`, кэш запросов liveQuery с задержкой освобождения 3 с).
