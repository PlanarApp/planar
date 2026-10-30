---
title: Developing modules
description: Module structure and the plugin sandbox
---

# Developing modules

Planar features are modules under `modules/*` (for example `sprints`, `time`, `forms`, `automations`, `webhooks`, `dashboards`, `docs`, `gitlab`, `import`). Modules are enabled per instance. The reference is the minimal module `modules/hello`.

## Module layout

```
modules/hello/
  package.json        # @planar/module-hello, exports ./shared, ./api, ./api/schema
  shared/index.ts     # SharedModuleManifest: id, mutators, entities (zod schemas)
  api/schema.ts       # drizzle tables
  api/index.ts        # BackendModuleManifest: nestModule, mutators, entities
```

- **shared** (code common to web and api): `defineMutator({ name, args, run })` describes a mutation that the client applies optimistically and the server confirms; `entities` are entities with a zod schema and metadata (`scope`, `write`, `bootstrap`, `indexes`).
- **api**: a Nest module with controllers (in the example `GET /api/hello/ping`) and a manifest that assembles `id`, `mutators` and `entities` from shared.

The minimal manifest from `modules/hello/shared/index.ts`:

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

How a module is registered in the build and the module contracts are described in the repository under `docs/contracts/` (contract C-modules); they are not duplicated here.

## Page plugins

A plugin is a separate HTML page in a sandboxed frame; the example is `examples/plugin-hello/index.html`. Host it on a **different host** than the app (a different port is not enough) and register it in Settings → Plugins. The page talks to the host via `postMessage` with the field `planar: 1`: it sends `ready`, receives `init` (the user and a context, e.g. `taskPanel` with `taskId`), and sends `query` (read entities, `read` permission), `mutate` (write, `write` permission, e.g. `comment.create`) and `resize`. The host checks the origin and source of messages.
