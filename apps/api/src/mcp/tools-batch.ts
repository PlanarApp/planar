import type { RestService } from '../rest/rest.service.js';
import { batchBody } from '../rest/batch.js';
import type { ToolDef } from './tools.js';

/** PLNRAPP-268: one confirmation per batch in chat — hence danger 'bulk' (already in JobTool.danger). */
export const batchDefs = (rest: RestService): ToolDef[] => [
  {
    name: 'batch_update_tasks',
    description:
      'Пачечное изменение до 100 задач (taskIds или filter): patch {statusId, projectId, labelIds{add,remove}, assigneeIds{add,remove}, fields, archived}. dryRun:true — только список задач без изменений; в чате без dryRun нужно подтверждение',
    shape: batchBody.shape,
    write: true,
    danger: 'bulk',
    run: async (a, uid, tokenId) => (await rest.batchTasks(uid, a, tokenId)).data,
  },
];
