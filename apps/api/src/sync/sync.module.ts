import { ActivityController } from './activity.controller.js';
import { ChangeNotifier } from './notify.js';
import { PullService } from './pull.service.js';
import { PushService } from './push.service.js';
import { PushController, PushQueue } from '../push/push.js';
import { SyncController } from './sync.controller.js';
import { SyncGateway } from './ws.js';

/** Подключаются в AppModule.register (DB и AUTH_OPTS — оттуда). */
export const syncControllers = [SyncController, ActivityController, PushController];
export const syncProviders = [PushQueue, PushService, PullService, ChangeNotifier, SyncGateway];
