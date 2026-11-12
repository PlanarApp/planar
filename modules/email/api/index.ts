import { Module, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { BackendModuleManifest } from '@planar/shared';
import type { Db } from '@planar/server-kit';
import { shared } from '../shared/index.js';
import { EmailController } from './controller.js';
import { digestTick, jobs, notifyTick } from './mail.js';
import { emailConfig } from './schema.js';

@Module({ controllers: [EmailController] })
class EmailModule implements OnModuleInit {
  constructor(private readonly host: HttpAdapterHost) {}
  // RFC 8058: One-Click arrives as application/x-www-form-urlencoded; Fastify does not parse that type by default
  onModuleInit() {
    try {
      this.host.httpAdapter
        .getInstance()
        .addContentTypeParser(
          'application/x-www-form-urlencoded',
          { parseAs: 'string' },
          (r: { url?: string }, b: unknown, done: (e: Error | null, v?: unknown) => void) => {
            // only this route; on the others — as before the module (415)
            if (r.url?.split('?')[0] === '/api/email/unsubscribe') return done(null, b);
            done(Object.assign(new Error('Unsupported Media Type'), { statusCode: 415 }));
          },
        );
    } catch {
      /* already exists */
    }
  }
}

export { digestTick, notifyTick };
export { esc, loadCfg, safeErr, send, type Mail, type Send, type SmtpCfg } from './mail.js';

/** Without SMTP settings the module cannot be enabled (C-modules v11). */
const unavailable = async (q: unknown): Promise<string | null> => {
  const [c] = await (q as Db).select().from(emailConfig);
  return c?.host && c.fromAddress ? null : 'smtp_not_configured';
};

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: EmailModule,
  mutators: shared.mutators,
  entities: shared.entities,
  jobs,
  unavailable,
};
