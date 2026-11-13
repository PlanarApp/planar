import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { getAuth } from '../auth/auth.js';
import { HttpError } from '../auth/errors.js';
import { Public } from '../auth/public.js';
import { parseBody } from '../auth/validate.js';
import { passwordSchema } from '../users/users.controller.js';
import { CloudService } from './cloud.service.js';

const domainBody = z.object({ host: z.string().trim().max(253).nullable() });
const egressBody = z.object({ domains: z.array(z.string().trim().max(253)).max(100).nullable() });
const aiBody = z.object({ enabled: z.boolean() });
const deleteBody = z.object({ confirm: z.string().max(100) });
const resetBody = z.object({ confirm: z.string().max(100), password: passwordSchema });

/** cloud-link: the "Cloud" settings tab and the payment screen — instance owner and admins only. */
@Controller('api/cloud')
export class CloudController {
  constructor(@Inject(CloudService) private readonly cloud: CloudService) {}

  private admin(req: object) {
    const { role } = getAuth(req);
    if (role !== 'owner' && role !== 'admin')
      throw new HttpError(403, 'forbidden', 'Только для администраторов');
  }

  @Get()
  async state(@Req() req: object) {
    this.admin(req);
    return this.cloud.state();
  }

  @Post('domain')
  @HttpCode(200)
  async domain(@Req() req: object, @Body() body: unknown) {
    this.admin(req);
    const { host } = parseBody(domainBody, body);
    return this.cloud.setDomain(host || null);
  }

  /** Egress of the AI agents («Settings → AI»): the instance owner decides, the cloud applies (PLNRAPP-242). */
  @Post('egress')
  @HttpCode(200)
  async egress(@Req() req: object, @Body() body: unknown) {
    this.admin(req);
    return this.cloud.setEgress(parseBody(egressBody, body).domains);
  }

  /** AI agents of the instance (cloud-link v2): on trial — 1 replica, on a paid subscription — with the AI add-on. */
  @Post('ai')
  @HttpCode(200)
  async ai(@Req() req: object, @Body() body: unknown) {
    this.admin(req);
    return this.cloud.setAi(parseBody(aiBody, body).enabled);
  }

  @Post('delete')
  @HttpCode(204)
  async remove(@Req() req: object, @Body() body: unknown) {
    this.owner(req);
    await this.cloud.deleteInstance(parseBody(deleteBody, body).confirm);
  }

  /** Data export archive (db dump + files) — a download link in the cloud. */
  @Post('export')
  @HttpCode(200)
  async exportData(@Req() req: object) {
    this.owner(req);
    return this.cloud.exportData();
  }

  /** Data import from an export archive: url — a one-time upload address in the cloud, the browser sends the file there. */
  @Post('import')
  @HttpCode(200)
  async importData(@Req() req: object, @Body() body: unknown) {
    this.owner(req);
    return this.cloud.importData(parseBody(deleteBody, body).confirm);
  }

  /** Data wipe: the cloud runs it in the background; url — the cloud's waiting page, then a one-time sign-in. */
  @Post('reset')
  @HttpCode(200)
  async reset(@Req() req: object, @Body() body: unknown) {
    this.owner(req);
    return this.cloud.resetInstance(parseBody(resetBody, body));
  }

  /** The cloud admin's "open instance": a one-time sign-in token of the owner; authorized by CLOUD_TOKEN. */
  @Public()
  @Post('handoff')
  @HttpCode(200)
  async handoff(@Headers('authorization') auth?: string) {
    return { token: await this.cloud.handoff(auth) };
  }

  private owner(req: object) {
    if (getAuth(req).role !== 'owner')
      throw new HttpError(403, 'forbidden', 'Только для владельца инстанса');
  }
}
