---
title: REST API
description: How to get the Planar OpenAPI specification
---

# REST API

The REST API lives under `/api/v1`. Authentication is a personal API token `plnr_…` with `read` or `write` permission (create it in the profile → "API tokens", see [MCP](/mcp#_1-token)), sent as `Authorization: Bearer plnr_…`.

The server builds the OpenAPI 3.1 specification from zod schemas (`apps/api/src/rest/openapi.ts`) and serves it at:

```bash
curl -fsS -H "Authorization: Bearer plnr_xxxxxxxx" https://planar.example.com/api/v1/openapi.json -o openapi.json
```

The header is included in case your instance requires authentication for all of `/api/v1`; whether `openapi.json` itself requires it is not stated in the controller code.

Take the endpoint list, parameters and models from that file: it always matches your instance's version, including the endpoints of installed modules. The MCP tools `create_task`, `update_task` and `list_fields` mirror the corresponding `/api/v1` endpoints (see [MCP](/mcp)).
