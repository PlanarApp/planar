import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.js';

/** Build values come from the image (build-args in CI, apps/api/Dockerfile); locally — `dev`. */
export function buildVersion(env: NodeJS.ProcessEnv = process.env) {
  return {
    commit: env.APP_COMMIT_SHA || 'dev',
    ref: env.APP_REF || 'dev',
    tag: env.APP_TAG || null,
    builtAt: env.APP_BUILT_AT || 'dev',
  };
}

/** GET /api/version — which build is running (public). */
@Public()
@Controller('api/version')
export class VersionController {
  @Get()
  version() {
    return buildVersion();
  }
}
