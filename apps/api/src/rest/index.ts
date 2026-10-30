import { RestController } from './rest.controller.js';
import { RestService } from './rest.service.js';

/** Connected in AppModule.register. */
export const restControllers = [RestController];
export const restProviders = [RestService];
