import { Module } from '@nestjs/common';
import type { BackendModuleManifest } from '@planar/shared';
import { shared } from '../shared/index.js';
import { GitlabController } from './controller.js';
import { afterMutation, jobs } from './poll.js';

@Module({ controllers: [GitlabController] })
class GitlabModule {}

export { pollAll } from './poll.js';

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: GitlabModule,
  mutators: shared.mutators,
  entities: shared.entities,
  afterMutation: afterMutation as BackendModuleManifest['afterMutation'],
  jobs,
};
