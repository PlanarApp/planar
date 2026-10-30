# Contributing to Planar

Thanks for your interest. The primary repository is https://gitlab.com/planarhq/planar (merge requests); https://github.com/PlanarApp/planar is a mirror.

## Language

Code, comments, commit messages and issues are written in English.

## Development setup

Requirements: Docker with the compose plugin, Node >= 24, pnpm.

```bash
pnpm install
./dev.sh up      # dev stack: postgres, api (watch), web (vite)
./dev.sh seed    # demo data (--tasks 10000 for measurements)
./dev.sh logs
./dev.sh down    # ./dev.sh reset also drops volumes
```

Parallel dev stacks: set `COMPOSE_PROJECT_NAME`, `API_PORT`, `WEB_PORT` (see `.env.example`).

## Checks before a merge request

```bash
./dev.sh test    # starts the test database, then pnpm test
pnpm lint        # eslint + prettier --check
pnpm -r build
```

## Writing a module

Features are modules in `modules/*`. Start from `modules/hello`: `shared/index.ts` (id, mutators, entities), `api/index.ts` (a NestJS module exported as a `BackendModuleManifest`) and `api/schema.ts` (tables). Mutators are shared functions that run optimistically on the client and in a transaction on the server. Plugins embedded as sandboxed pages: see `examples/plugin-hello`.

## Sign-off (DCO)

There is no CLA. Every commit must carry a `Signed-off-by` line certifying the [Developer Certificate of Origin](https://developercertificate.org/):

```bash
git commit -s -m "Fix task ordering"
```

## Merge requests

Keep a change focused, add or update tests, and describe what and why. Report vulnerabilities privately, see [SECURITY.md](SECURITY.md). By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are licensed under Apache-2.0.
