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
import { SYNC_PROTOCOL_HEADER, syncPushRequestSchema } from '@planar/shared';
import { getAuth } from '../auth/auth.js';
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
    const { clientId, cursor } = parse(pullQuery, q);
    return this.pull.pull(getAuth(req).userId, clientId, cursor);
  }

  @Post('push')
  @HttpCode(200)
  pushMutations(@Req() req: object, @Body() body: unknown) {
    const a = getAuth(req);
    return this.push.push(a.userId, parse(syncPushRequestSchema, body), a.tokenId);
  }
}
