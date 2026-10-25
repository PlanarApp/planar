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
  // RFC 8058: One-Click приходит как application/x-www-form-urlencoded; Fastify такой тип по умолчанию не разбирает
  onModuleInit() {
    try {
      this.host.httpAdapter
        .getInstance()
        .addContentTypeParser(
          'application/x-www-form-urlencoded',
          { parseAs: 'string' },
          (_r: unknown, b: unknown, done: (e: null, v: unknown) => void) => done(null, b),
        );
    } catch {
      /* уже есть */
    }
  }
}

export { digestTick, notifyTick };

/** Без настроек SMTP модуль включить нельзя (C-modules v11). */
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
