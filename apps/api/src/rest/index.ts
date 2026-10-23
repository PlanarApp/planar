import { RestController } from './rest.controller.js';
import { RestService } from './rest.service.js';

/** Подключаются в AppModule.register. */
export const restControllers = [RestController];
export const restProviders = [RestService];
