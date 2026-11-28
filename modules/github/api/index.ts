import { Module } from '@nestjs/common';
import type { BackendModuleManifest } from '@planar/shared';
import { shared } from '../shared/index.js';
import { GithubController } from './controller.js';
import { afterMutation } from './hooks.js';
import { jobs } from './poll.js';

@Module({ controllers: [GithubController] })
class GithubModule {}

export { githubToken } from './controller.js';
export { resolveConnection } from './connections.js';
export { syncBinding, syncProject } from './sync.js';
export { pollAll } from './poll.js';

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: GithubModule,
  mutators: shared.mutators,
  entities: shared.entities,
  afterMutation: afterMutation as BackendModuleManifest['afterMutation'],
  jobs,
};
