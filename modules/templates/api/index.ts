import { Module } from '@nestjs/common';
import type { BackendModuleManifest } from '@planar/shared';
import { shared } from '../shared/index.js';

@Module({})
class TemplatesModule {}

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: TemplatesModule,
  mutators: shared.mutators,
  entities: shared.entities,
};
