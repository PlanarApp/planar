import { z } from 'zod';
import { entitySchemas, httpErrorSchema, v1TaskSchema } from '@planar/shared';
import { installed } from '../modules/installed.js';
import {
  commentBody,
  commentSchema,
  createTaskBody,
  fieldDefSchema,
  linkBody,
  patchTaskBody,
  projectSchema,
  spaceSchema,
  tasksQuery,
  timeEntriesQuery,
  timeLogBody,
  timerStartBody,
} from './schemas.js';

/** схема сущности модуля (нет модуля — произвольный объект) */
const ent = (name: string): z.ZodType =>
  installed.map((m) => m.api.entities[name]?.schema).find(Boolean) ?? z.looseObject({});
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
  Link: entitySchemas.taskLinks,
  CreateLink: linkBody,
  TimeEntry: ent('timeEntries'),
  LogTime: timeLogBody,
  StartTimer: timerStartBody,
  Cycle: ent('sprintsCycles'),
  AutomationRule: ent('automationsRules'),
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

type Mode = 'one' | 'page' | 'array' | 'null';
const ok = (model: string, mode: Mode = 'one', status = '200') => ({
  [status]: {
    description: 'OK',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: mode === 'page' ? ['data', 'nextCursor'] : ['data'],
          properties:
            mode === 'page'
              ? {
                  data: { type: 'array', items: ref(model) },
                  nextCursor: { type: ['string', 'null'] },
                }
              : mode === 'array'
                ? { data: { type: 'array', items: ref(model) } }
                : mode === 'null'
                  ? { data: { anyOf: [ref(model), { type: 'null' }] } }
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
      '/api/v1/spaces': { get: { parameters: paging, responses: ok('Space', 'page') } },
      '/api/v1/projects': {
        get: {
          parameters: [param('spaceId', 'query'), ...paging],
          responses: ok('Project', 'page'),
        },
      },
      '/api/v1/projects/{id}/fields': {
        get: { parameters: [param('id', 'path')], responses: ok('FieldDef', 'page') },
      },
      '/api/v1/tasks': {
        get: { parameters: [...queryParams, ...paging], responses: ok('Task', 'page') },
        post: { requestBody: body('CreateTask'), responses: ok('Task', 'one', '201') },
      },
      '/api/v1/tasks/{task}': {
        get: { parameters: [taskParam], responses: ok('Task') },
        patch: { parameters: [taskParam], requestBody: body('PatchTask'), responses: ok('Task') },
      },
      '/api/v1/tasks/{task}/comments': {
        get: { parameters: [taskParam, ...paging], responses: ok('Comment', 'page') },
        post: {
          parameters: [taskParam],
          requestBody: body('CreateComment'),
          responses: ok('Comment', 'one', '201'),
        },
      },
      '/api/v1/tasks/{task}/links': {
        get: { parameters: [taskParam], responses: ok('Link', 'array') },
        post: {
          parameters: [taskParam],
          requestBody: body('CreateLink'),
          responses: ok('Link', 'one', '201'),
        },
      },
      '/api/v1/links/{id}': {
        delete: {
          parameters: [param('id', 'path')],
          responses: {
            '204': { description: 'Удалено' },
            default: ok('Error').default,
          },
        },
      },
      '/api/v1/time-entries': {
        get: {
          parameters: [
            ...Object.keys(timeEntriesQuery.shape)
              .filter((k) => k !== 'limit' && k !== 'cursor')
              .map((k) => param(k, 'query')),
            ...paging,
          ],
          responses: ok('TimeEntry', 'page'),
        },
        post: { requestBody: body('LogTime'), responses: ok('TimeEntry', 'one', '201') },
      },
      '/api/v1/timer': { get: { responses: ok('TimeEntry', 'null') } },
      '/api/v1/timer/start': {
        post: { requestBody: body('StartTimer'), responses: ok('TimeEntry', 'one', '201') },
      },
      '/api/v1/timer/stop': { post: { responses: ok('TimeEntry', 'null') } },
      '/api/v1/projects/{id}/cycles': {
        get: { parameters: [param('id', 'path')], responses: ok('Cycle', 'array') },
      },
      '/api/v1/projects/{id}/cycles/current': {
        get: { parameters: [param('id', 'path')], responses: ok('Cycle', 'null') },
      },
      '/api/v1/projects/{id}/automations': {
        get: { parameters: [param('id', 'path')], responses: ok('AutomationRule', 'array') },
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
