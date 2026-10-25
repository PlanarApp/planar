import { Module } from '@nestjs/common';
import type { BackendModuleManifest } from '@planar/shared';
import { shared } from '../shared/index.js';
import { PluginsController } from './controller.js';

@Module({ controllers: [PluginsController] })
class PluginsModule {}

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: PluginsModule,
  mutators: shared.mutators,
  entities: shared.entities,
};
