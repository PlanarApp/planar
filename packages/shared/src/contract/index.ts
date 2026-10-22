import { httpErrorSchema } from './http.js';
import {
  syncBootstrapSchema,
  syncPullSchema,
  syncPushRequestSchema,
  syncPushResponseSchema,
  wsClientSchema,
  wsServerSchema,
} from './sync.js';

export * from './versions.js';
export * from './entities.js';
export * from './sync.js';
export * from './http.js';
export * from './mutator.js';
export * from './ids.js';
export * from './modules.js';

export const contractSchemas = {
  'sync.bootstrap': syncBootstrapSchema,
  'sync.pull': syncPullSchema,
  'sync.pushRequest': syncPushRequestSchema,
  'sync.pushResponse': syncPushResponseSchema,
  'ws.server': wsServerSchema,
  'ws.client': wsClientSchema,
  'http.error': httpErrorSchema,
} as const;
