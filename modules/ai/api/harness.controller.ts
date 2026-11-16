import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { CORE, parseBody, type CoreServices } from '@planar/server-kit';
import { applyPack, diffPack } from './harness-apply.js';
import { assertAiAdmin } from './packs.js';

const body = z.object({
  projectId: z.uuid(),
  packPageId: z.uuid(),
  /** status key to delete → key of the status its tasks move to */
  replaceWith: z.record(z.string(), z.string()).optional(),
});

@Controller('api/ai/harness')
export class HarnessController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  /** Admin of the project with the module on. A token works with write scope (a read token is refused by the guard for POST). */
  private async admin(req: object, projectId: string) {
    const a = this.core.auth(req);
    await assertAiAdmin(this.core.db, a.userId, projectId);
    return a;
  }

  @Post('diff')
  @HttpCode(200)
  async diff(@Req() req: object, @Body() raw: unknown) {
    const b = parseBody(body, raw);
    await this.admin(req, b.projectId);
    return diffPack(this.core, b);
  }

  @Post('apply')
  @HttpCode(200)
  async apply(@Req() req: object, @Body() raw: unknown) {
    const b = parseBody(body, raw);
    const a = await this.admin(req, b.projectId);
    return applyPack(this.core, a.userId, b);
  }
}
