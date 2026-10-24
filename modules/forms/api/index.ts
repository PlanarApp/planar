import { Module } from '@nestjs/common';
import type { BackendModuleManifest } from '@planar/shared';
import { shared } from '../shared/index.js';
import { FormsController } from './controller.js';

@Module({ controllers: [FormsController] })
class FormsModule {}

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: FormsModule,
  mutators: shared.mutators,
  entities: shared.entities,
};
