import { z } from 'zod';
import { httpErrorSchema, v1TaskSchema } from '@planar/shared';
import {
  commentBody,
  commentSchema,
  createTaskBody,
  fieldDefSchema,
  patchTaskBody,
  projectSchema,
  spaceSchema,
  tasksQuery,
} from './schemas.js';

const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const models = {
  Space: spaceSchema,
  Project: projectSchema,
  FieldDef: fieldDefSchema,
  Task: v1TaskSchema,
  Comment: commentSchema,
  Error: httpErrorSchema,
  CreateTask: createTaskBody,
  PatchTask: patchTaskBody,
  CreateComment: commentBody,
};

const param = (name: string, where: 'query' | 'path', schema: object = { type: 'string' }) => ({
  name,
  in: where,
  required: where === 'path',
  schema,
});
const paging = [
  param('limit', 'query', { type: 'integer', minimum: 1, maximum: 200, default: 50 }),
  param('cursor', 'query'),
];
const taskParam = param('task', 'path');

const ok = (model: string, list = false, status = '200') => ({
  [status]: {
    description: 'OK',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: list ? ['data', 'nextCursor'] : ['data'],
          properties: list
            ? {
                data: { type: 'array', items: ref(model) },
                nextCursor: { type: ['string', 'null'] },
              }
            : { data: ref(model) },
        },
      },
    },
  },
  default: { description: 'Ошибка', content: { 'application/json': { schema: ref('Error') } } },
});
const body = (model: string) => ({
  required: true,
  content: { 'application/json': { schema: ref(model) } },
});

/** OpenAPI 3.1 из zod-схем (GET /api/v1/openapi.json). */
export function openapi() {
  const queryParams = Object.keys(tasksQuery.shape)
    .filter((k) => k !== 'limit' && k !== 'cursor')
    .map((k) => param(k, 'query'));
  return {
    openapi: '3.1.0',
    info: { title: 'Planar API', version: '1' },
    security: [{ bearer: [] }],
    paths: {
      '/api/v1/spaces': { get: { parameters: paging, responses: ok('Space', true) } },
      '/api/v1/projects': {
        get: { parameters: [param('spaceId', 'query'), ...paging], responses: ok('Project', true) },
      },
      '/api/v1/projects/{id}/fields': {
        get: { parameters: [param('id', 'path')], responses: ok('FieldDef', true) },
      },
      '/api/v1/tasks': {
        get: { parameters: [...queryParams, ...paging], responses: ok('Task', true) },
        post: { requestBody: body('CreateTask'), responses: ok('Task', false, '201') },
      },
      '/api/v1/tasks/{task}': {
        get: { parameters: [taskParam], responses: ok('Task') },
        patch: { parameters: [taskParam], requestBody: body('PatchTask'), responses: ok('Task') },
      },
      '/api/v1/tasks/{task}/comments': {
        get: { parameters: [taskParam, ...paging], responses: ok('Comment', true) },
        post: {
          parameters: [taskParam],
          requestBody: body('CreateComment'),
          responses: ok('Comment', false, '201'),
        },
      },
    },
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      schemas: Object.fromEntries(
        Object.entries(models).map(([k, s]) => [k, z.toJSONSchema(s, { io: 'input' })]),
      ),
    },
  };
}
