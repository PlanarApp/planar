---
title: Разработка модулей
description: Структура модуля и песочница плагинов
---

# Разработка модулей

Функции Planar — модули в `modules/*` (например `sprints`, `time`, `forms`, `automations`, `webhooks`, `dashboards`, `docs`, `gitlab`, `import`). Модули включаются на уровне инстанса. Эталон — минимальный модуль `modules/hello`.

## Структура модуля

```
modules/hello/
  package.json        # @planar/module-hello, exports ./shared, ./api, ./api/schema
  shared/index.ts     # SharedModuleManifest: id, мутаторы, сущности (zod-схемы)
  api/schema.ts       # таблицы drizzle
  api/index.ts        # BackendModuleManifest: nestModule, mutators, entities
```

- **shared** (общий код веба и api): `defineMutator({ name, args, run })` описывает мутацию, которую клиент применяет оптимистично, а сервер подтверждает; `entities` — сущности со схемой zod и мета-данными (`scope`, `write`, `bootstrap`, `indexes`).
- **api**: Nest-модуль с контроллерами (в примере `GET /api/hello/ping`) и манифест, собирающий `id`, `mutators`, `entities` из shared.

Минимальный манифест из `modules/hello/shared/index.ts`:

```ts
export const shared: SharedModuleManifest = {
  id: 'hello',
  mutators: [create],
  entities: {
    helloNotes: {
      schema: helloNotes,
      meta: { scope: 'space', write: 'member', bootstrap: true, indexes: ['spaceId'] },
    },
  },
};
```

Регистрация модуля в сборке и контракты модулей описаны в репозитории в `docs/contracts/` (контракт C-modules); здесь они не дублируются.

## Плагины-страницы

Плагин — отдельная HTML-страница во фрейме-песочнице, пример — `examples/plugin-hello/index.html`. Разместите её на **другом хосте**, чем приложение (другого порта недостаточно), и зарегистрируйте в «Настройки → Плагины». Страница общается с хостом через `postMessage` с полем `planar: 1`: отправляет `ready`, получает `init` (пользователь и контекст, например `taskPanel` с `taskId`), шлёт `query` (чтение сущностей, право `read`), `mutate` (запись, право `write`, например `comment.create`) и `resize`. Хост проверяет origin и источник сообщений.
