import type { z } from 'zod';
import type { Db } from '../../db/index.js';

/** Dependencies of an operation: everything goes through RestService (rights — of `userId`). */
export interface ExtDeps {
  db: Db;
  run(userId: string, muts: { name: string; args: unknown }[], tokenId?: string): Promise<void>;
  /** 404 for a foreign / hidden project */
  visibleProject(userId: string, id: string): Promise<string>;
  /** public URL of the instance (links in answers); '' when unknown */
  origin: string;
  /** 404 module_disabled unless the module is on in the project */
  moduleOn(userId: string | undefined, module: string, projectId: string): Promise<void>;
}

/** One operation, described once: REST route, OpenAPI path, MCP and chat tool are built from it (docs/contracts/mcpall.md). */
export interface ExtOp {
  /** MCP tool name, snake_case, unique */
  tool: string;
  description: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** '/api/v1/spaces/{id}/members'; {names} are path params */
  path: string;
  /** FULL input: path params + body (POST/PUT/PATCH) or query (GET/DELETE) */
  shape: z.ZodRawShape;
  /** false: a read token is enough */
  write: boolean;
  /** every delete is 'delete'; irreversible/mass — 'bulk' */
  danger?: 'delete' | 'bulk';
  /** default 200 */
  status?: 200 | 201 | 204;
  /** OpenAPI response schema name (optional) */
  model?: string;
  /** returns the data without the {data} wrapper */
  run(d: ExtDeps, userId: string, input: object, tokenId?: string): Promise<unknown>;
}

export interface ExtArea {
  name: string;
  ops: ExtOp[];
}
