import { Inject, Injectable, Module } from '@nestjs/common';
import { CORE, type CoreServices } from '@planar/server-kit';
import type { BackendModuleManifest } from '@planar/shared';
import { shared } from '../shared/index.js';
import { WebhooksController } from './controller.js';
import { jobs } from './deliver.js';
import { afterMutation, setCore } from './events.js';

@Injectable()
class WebhooksBoot {
  constructor(@Inject(CORE) core: CoreServices) {
    setCore(core);
  }
}

@Module({ controllers: [WebhooksController], providers: [WebhooksBoot] })
class WebhooksModule {}

export { enqueueWebhookEvent } from './deliver.js';

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: WebhooksModule,
  mutators: shared.mutators,
  entities: shared.entities,
  afterMutation: afterMutation as BackendModuleManifest['afterMutation'],
  jobs,
};
