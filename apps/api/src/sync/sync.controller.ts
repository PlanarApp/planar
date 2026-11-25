import {
  BadRequestException,
  Body,
  HttpCode,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import {
  SYNC_PROTOCOL,
  SYNC_PROTOCOL_HEADER,
  syncPushRequestSchema,
  syncTasksRequestSchema,
} from '@planar/shared';
import { getAuth } from '../auth/auth.js';
import { HttpError } from '../auth/errors.js';
import { PullService } from './pull.service.js';
import { PushService } from './push.service.js';

function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join('; '));
  return r.data;
}

const bootstrapQuery = z.object({ clientId: z.uuid() });
/** C-sync v3: the client's protocol version; no header or not a number — v2. */
const protocolOf = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : 2);
const pullQuery = z.object({
  clientId: z.uuid(),
  cursor: z.coerce.number().int().min(0),
  page: z.enum(['1']).optional(),
});

@Controller('sync')
export class SyncController {
  constructor(
    @Inject(PullService) private pull: PullService,
    @Inject(PushService) private push: PushService,
  ) {}

  @Get('bootstrap')
  bootstrap(
    @Req() req: object,
    @Query() q: unknown,
    @Headers(SYNC_PROTOCOL_HEADER.toLowerCase()) protocol?: string,
  ) {
    return this.pull.bootstrap(
      getAuth(req).userId,
      parse(bootstrapQuery, q).clientId,
      protocolOf(protocol),
    );
  }

  @Get('pull')
  pullChanges(@Req() req: object, @Query() q: unknown) {
    const { clientId, cursor, page } = parse(pullQuery, q);
    return this.pull.pull(getAuth(req).userId, clientId, cursor, !!page);
  }

  @Post('push')
  @HttpCode(200)
  pushMutations(@Req() req: object, @Body() body: unknown) {
    const a = getAuth(req);
    return this.push.push(a.userId, parse(syncPushRequestSchema, body), a.tokenId);
  }

  /** C-sync v3: snapshot of task details with cursor; protocol < 3 → 426. */
  @Post('tasks')
  @HttpCode(200)
  taskDetails(@Req() req: object, @Body() body: unknown) {
    const { protocol, ids } = parse(syncTasksRequestSchema, body);
    if (protocol < SYNC_PROTOCOL)
      throw new HttpError(
        426,
        'upgrade_required',
        'Обновите клиент: нужен протокол синхронизации 3',
      );
    return this.pull.taskDetails(getAuth(req).userId, ids);
  }
}
