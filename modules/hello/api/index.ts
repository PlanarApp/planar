import { Controller, Get, Module } from '@nestjs/common';
import type { BackendModuleManifest } from '@planar/shared';
import { shared } from '../shared/index.js';

@Controller('api/hello')
class HelloController {
  @Get('ping')
  ping() {
    return { ok: true };
  }
}

@Module({ controllers: [HelloController] })
class HelloModule {}

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: HelloModule,
  mutators: shared.mutators,
  entities: shared.entities,
};
