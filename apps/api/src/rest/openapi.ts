import { z } from 'zod';
import { entitySchemas, httpErrorSchema, v1TaskSchema } from '@planar/shared';
import { installed } from '../modules/installed.js';
import { batchBody, batchResult } from './batch.js';
import { extOps, pathParams } from './ext/index.js';
import { SETTING_OPS, setModuleSchema } from './settings.js';
import {
  commentBody,
  commentSchema,
  createDocBody,
  createTaskBody,
  docCommentBody,
  docPatchBody,
  docTaskBody,
  docsQuery,
  fieldDefSchema,
  linkBody,
  patchCommentBody,
  patchDocBody,
  patchTaskBody,
  projectSchema,
  spaceSchema,
  tasksQuery,
  timeEntriesQuery,
  timeLogBody,
  timerStartBody,
} from './schemas.js';

/** entity schema of the module (no module — arbitrary object) */
const ent = (name: string): z.ZodType =>
  installed.map((m) => m.api.entities[name]?.schema).find(Boolean) ?? z.looseObject({});
const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
// a page goes out without body/text/files; get adds markdown and linked tasks
const page = ent('docsPages');
const docPage =
  page instanceof z.ZodObject ? page.omit({ body: true, text: true, files: true }) : page;
const models = {
  Space: spaceSchema,
  Project: projectSchema,
  FieldDef: fieldDefSchema,
  Task: v1TaskSchema,
  Comment: commentSchema,
  Error: httpErrorSchema,
  CreateTask: createTaskBody,
  PatchTask: patchTaskBody,
  BatchTasks: batchBody,
  BatchResult: batchResult,
  CreateComment: commentBody,
  PatchComment: patchCommentBody,
  Link: entitySchemas.taskLinks,
  CreateLink: linkBody,
  TimeEntry: ent('timeEntries'),
  LogTime: timeLogBody,
  StartTimer: timerStartBody,
  Cycle: ent('sprintsCycles'),
  AutomationRule: ent('automationsRules'),
  DocPage: docPage,
  Doc: z.intersection(
    docPage,
    z.object({
      markdown: z.string(),
      tasks: z.array(z.object({ id: z.uuid(), key: z.string(), title: z.string() })),
    }),
  ),
  CreateDoc: createDocBody,
  PatchDoc: patchDocBody,
  LinkDocTask: docTaskBody,
  CreateDocComment: docCommentBody,
  PatchDocPage: docPatchBody,
  DocComment: z.object({
    id: z.uuid(),
    parentId: z.uuid().nullable(),
    authorId: z.uuid(),
    text: z.string(),
    assigneeId: z.uuid().nullable(),
    resolved: z.boolean(),
    createdAt: z.string(),
  }),
  PagePatchResult: z.object({ ok: z.literal(true), versionId: z.uuid().optional() }),
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

// project settings (PLNRAPP-266): REST path of each mutator; the id/projectId come from the path
const SETTING_PATHS: Record<string, [string, 'post' | 'patch' | 'delete', string]> = {
  'status.create': ['/api/v1/projects/{id}/statuses', 'post', 'Status'],
  'status.update': ['/api/v1/statuses/{id}', 'patch', 'Status'],
  'status.delete': ['/api/v1/statuses/{id}', 'delete', ''],
  'label.create': ['/api/v1/projects/{id}/labels', 'post', 'Label'],
  'label.update': ['/api/v1/labels/{id}', 'patch', 'Label'],
  'label.delete': ['/api/v1/labels/{id}', 'delete', ''],
  'field.create': ['/api/v1/projects/{id}/fields', 'post', 'FieldDef'],
  'field.update': ['/api/v1/fields/{id}', 'patch', 'FieldDef'],
  'field.delete': ['/api/v1/fields/{id}', 'delete', ''],
  'automations.create': ['/api/v1/projects/{id}/automations', 'post', 'AutomationRule'],
  'automations.update': ['/api/v1/automations/{id}', 'patch', 'AutomationRule'],
  'automations.delete': ['/api/v1/automations/{id}', 'delete', ''],
  'ai.action.create': ['/api/v1/projects/{id}/ai-actions', 'post', 'AiAction'],
  'ai.action.update': ['/api/v1/ai-actions/{id}', 'patch', 'AiAction'],
  'ai.action.delete': ['/api/v1/ai-actions/{id}', 'delete', ''],
  'project.update': ['/api/v1/projects/{id}', 'patch', 'Project'],
};
const settingBody = (o: (typeof SETTING_OPS)[number]) =>
  o.schema.omit(o.kind === 'create' ? { projectId: true } : { id: true });
const settingModels = Object.fromEntries(
  SETTING_OPS.filter((o) => o.kind !== 'delete').map((o) => [`Setting_${o.tool}`, settingBody(o)]),
);
const settingPaths = () => {
  const paths: Record<string, Record<string, unknown>> = {
    '/api/v1/projects/{id}/modules/{moduleId}': {
      put: {
        parameters: [param('id', 'path'), param('moduleId', 'path')],
        requestBody: body('SetModule'),
        responses: ok('Project'),
      },
    },
    '/api/v1/projects/{id}/ai-actions': {
      get: { parameters: [param('id', 'path')], responses: ok('AiAction', 'array') },
    },
  };
  for (const o of SETTING_OPS) {
    const [path, method, model] = SETTING_PATHS[o.mutator]!;
    paths[path] = {
      ...paths[path],
      [method]: {
        parameters: [
          param('id', 'path'),
          ...(o.mutator === 'status.delete' ? [param('replaceWith', 'query')] : []),
        ],
        ...(o.kind === 'delete' ? {} : { requestBody: body(`Setting_${o.tool}`) }),
        responses:
          o.kind === 'delete'
            ? { '204': { description: 'Удалено' }, default: ok('Error').default }
            : ok(model, 'one', o.kind === 'create' ? '201' : '200'),
      },
    };
  }
  return paths;
};
const KNOWN_MODELS = new Set([...Object.keys(models), 'Status', 'Label', 'AiAction']);
/** paths of ExtOp (rest/ext): path params, query (GET/DELETE) or body from the shape, response by status */
const extPaths = () => {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const o of extOps()) {
    const inPath = pathParams(o.path);
    const rest = z.object(o.shape).omit(Object.fromEntries(inPath.map((n) => [n, true])));
    const json = z.toJSONSchema(rest, { io: 'input' }) as {
      properties?: Record<string, object>;
      required?: string[];
    };
    const query = o.method === 'get' || o.method === 'delete';
    const status = o.status ?? 200;
    paths[o.path] = {
      ...paths[o.path],
      [o.method]: {
        operationId: o.tool,
        description: o.description,
        parameters: [
          ...inPath.map((n) => param(n, 'path')),
          ...(query
            ? Object.entries(json.properties ?? {}).map(([n, schema]) => ({
                ...param(n, 'query', schema),
                required: json.required?.includes(n) ?? false,
              }))
            : []),
        ],
        ...(query
          ? {}
          : { requestBody: { required: true, content: { 'application/json': { schema: json } } } }),
        responses:
          status === 204
            ? { '204': { description: 'Выполнено' }, default: ok('Error').default }
            : o.model && KNOWN_MODELS.has(o.model) // an unknown name would be a dangling $ref
              ? ok(o.model, 'one', String(status))
              : {
                  [String(status)]: {
                    description: 'OK',
                    content: {
                      'application/json': {
                        schema: { type: 'object', required: ['data'], properties: { data: {} } },
                      },
                    },
                  },
                  default: ok('Error').default,
                },
      },
    };
  }
  return paths;
};
/** merge of methods of the same path */
const mergePaths = (a: Record<string, object>, b: Record<string, object>) =>
  Object.fromEntries(
    [...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, { ...a[k], ...b[k] }]),
  );

/** OpenAPI 3.1 from zod schemas (GET /api/v1/openapi.json). */
export function openapi() {
  const queryParams = Object.keys(tasksQuery.shape)
    .filter((k) => k !== 'limit' && k !== 'cursor')
    .map((k) => param(k, 'query'));
  return {
    openapi: '3.1.0',
    info: { title: 'Planar API', version: '1' },
    security: [{ bearer: [] }],
    paths: mergePaths(
      {
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
        '/api/v1/tasks/batch': {
          post: { requestBody: body('BatchTasks'), responses: ok('BatchResult') },
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
        '/api/v1/comments/{id}': {
          patch: {
            parameters: [param('id', 'path')],
            requestBody: body('PatchComment'),
            responses: ok('Comment'),
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
        '/api/v1/docs': {
          get: {
            parameters: Object.keys(docsQuery.shape).map((k) => ({
              ...param(k, 'query'),
              required: k === 'projectId',
            })),
            responses: ok('DocPage', 'array'),
          },
          post: { requestBody: body('CreateDoc'), responses: ok('Doc', 'one', '201') },
        },
        '/api/v1/docs/{id}': {
          get: {
            parameters: [param('id', 'path'), param('section', 'query')],
            responses: ok('Doc'),
          },
          patch: {
            parameters: [param('id', 'path')],
            requestBody: body('PatchDoc'),
            responses: ok('Doc'),
          },
        },
        '/api/v1/docs/{id}/comments': {
          get: { parameters: [param('id', 'path')], responses: ok('DocComment', 'array') },
          post: {
            parameters: [param('id', 'path')],
            requestBody: body('CreateDocComment'),
            responses: ok('DocComment', 'one', '201'),
          },
        },
        '/api/v1/docs/{id}/comments/{cid}/resolve': {
          post: {
            parameters: [param('id', 'path'), param('cid', 'path')],
            responses: ok('DocComment'),
          },
        },
        '/api/v1/docs/{id}/patch': {
          post: {
            parameters: [param('id', 'path')],
            requestBody: body('PatchDocPage'),
            responses: ok('PagePatchResult'),
          },
        },
        '/api/v1/docs/{id}/tasks': {
          post: {
            parameters: [param('id', 'path')],
            requestBody: body('LinkDocTask'),
            responses: ok('Doc', 'one', '201'),
          },
        },
      },
      mergePaths(settingPaths(), extPaths()),
    ),
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      schemas: Object.fromEntries(
        Object.entries({
          ...models,
          ...settingModels,
          Status: entitySchemas.statuses,
          Label: entitySchemas.labels,
          AiAction: ent('aiActions'),
          SetModule: setModuleSchema.omit({ projectId: true, moduleId: true }),
        }).map(([k, s]) => [k, z.toJSONSchema(s, { io: 'input' })]),
      ),
    },
  };
}
