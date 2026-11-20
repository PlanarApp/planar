import { apiTokenCreatedSchema, v1TaskSchema } from './api.js';
import { httpErrorSchema, pushPayloadSchema } from './http.js';
import { z } from 'zod';
import {
  syncBootstrapSchema,
  syncPullSchema,
  syncPushRequestSchema,
  syncPushResponseSchema,
  syncTasksRequestSchema,
  syncTasksResponseSchema,
  wsClientSchema,
  wsServerSchema,
} from './sync.js';

export * from './versions.js';
export * from './entities.js';
export * from './sync.js';
export * from './http.js';
export * from './api.js';
export * from './mutator.js';
export * from './ids.js';
export * from './modules.js';

export const contractSchemas = {
  'sync.bootstrap': syncBootstrapSchema,
  'sync.pull': syncPullSchema,
  'sync.pushRequest': syncPushRequestSchema,
  'sync.pushResponse': syncPushResponseSchema,
  'sync.tasksRequest': syncTasksRequestSchema,
  'sync.tasksResponse': syncTasksResponseSchema,
  'ws.server': wsServerSchema,
  'ws.client': wsClientSchema,
  'http.error': httpErrorSchema,
  'push.payload': pushPayloadSchema,
  'api.tokenCreated': apiTokenCreatedSchema,
  'api.v1.task': z.object({ data: v1TaskSchema }),
} as const;
