import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { uuidv7 } from '@planar/shared';
import { HttpError } from '../../auth/errors.js';
import * as s from '../../db/schema.js';
import { filesOptsOf, storeBuffer } from '../../files/store.js';
import { downloadUrl, taskAttachments } from './attachments.service.js';
import { findTask } from './tasks.service.js';
import type { ExtArea, ExtOp } from './types.js';

// PLNRAPP-273: task attachments over the existing mutators and the existing file store; binary data is never returned
const task = z.string().min(1).describe('uuid или ключ задачи, например ABC-123');
const id = z.uuid();

const ops: ExtOp[] = [
  {
    tool: 'list_task_attachments',
    description:
      'Вложения задачи: id, имя, тип, размер, размеры картинки, sha256 файла, комментарий, кто загрузил (содержимое не отдаётся)',
    method: 'get',
    path: '/api/v1/tasks/{task}/attachments',
    shape: { task },
    write: false,
    run: async (d, u, i) =>
      taskAttachments(d, (await findTask(d, u, (i as { task: string }).task)).id),
  },
  {
    tool: 'add_task_attachment',
    description:
      'Прикрепить файл к задаче (или к её комментарию): либо dataBase64, либо url (только публичные http/https; размер ограничен настройкой загрузки)',
    method: 'post',
    path: '/api/v1/tasks/{task}/attachments',
    shape: {
      task,
      name: z.string().min(1).max(255),
      mime: z.string().min(1).max(255).optional(),
      dataBase64: z.string().min(1).optional(),
      url: z.string().min(1).max(2048).optional(),
      commentId: id.optional(),
    },
    write: true,
    status: 201,
    run: async (d, u, i, tok) => {
      const a = i as {
        task: string;
        name: string;
        mime?: string;
        dataBase64?: string;
        url?: string;
        commentId?: string;
      };
      if (!a.dataBase64 === !a.url)
        throw new HttpError(400, 'invalid_request', 'Нужно ровно одно из dataBase64 и url');
      const t = await findTask(d, u, a.task);
      const opts = filesOptsOf(d.db);
      const max = opts.maxUploadMb * 1024 * 1024;
      let buf: Buffer;
      let mime = a.mime;
      if (a.dataBase64) {
        // the limit is checked before decoding
        if ((a.dataBase64.length * 3) / 4 > max + 3)
          throw new HttpError(413, 'payload_too_large', 'Файл слишком большой');
        buf = Buffer.from(a.dataBase64, 'base64');
      } else {
        const r = await downloadUrl(a.url!, max);
        buf = r.buf;
        mime ??= r.mime || undefined;
      }
      const f = await storeBuffer(d.db, opts, buf, u, mime);
      const aid = uuidv7();
      await d.run(
        u,
        [
          {
            name: 'attachment.create',
            args: {
              id: aid,
              taskId: t.id,
              commentId: a.commentId ?? null,
              fileSha256: f.sha256,
              name: a.name,
              mime: f.mime,
              size: f.size,
              width: f.width,
              height: f.height,
            },
          },
        ],
        tok,
      );
      return (await taskAttachments(d, t.id)).find((x) => x.id === aid);
    },
  },
  {
    tool: 'delete_attachment',
    description:
      'Удалить вложение задачи (файл на диске остаётся, если он есть в других вложениях)',
    method: 'delete',
    path: '/api/v1/attachments/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, tok) => {
      const { id: aid } = i as { id: string };
      const [row] = await d.db
        .select({ taskId: s.attachments.taskId })
        .from(s.attachments)
        .where(eq(s.attachments.id, aid));
      if (!row) throw new HttpError(404, 'not_found', 'Вложение не найдено');
      await findTask(d, u, row.taskId).catch(() => {
        throw new HttpError(404, 'not_found', 'Вложение не найдено');
      });
      await d.run(u, [{ name: 'attachment.delete', args: { id: aid } }], tok);
    },
  },
];

export const area: ExtArea = { name: 'attachments', ops };
