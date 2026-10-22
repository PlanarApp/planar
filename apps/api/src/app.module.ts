import { Module, type DynamicModule } from '@nestjs/common';
import type { Db } from './db/index.js';
import { HealthController } from './health.controller.js';
import { DB } from './tokens.js';

@Module({})
export class AppModule {
  static register(db: Db): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [{ provide: DB, useValue: db }],
    };
  }
}
