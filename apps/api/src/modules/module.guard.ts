import {
  Controller,
  Get,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { getAuth } from '../auth/auth.js';
import { HttpError } from '../auth/errors.js';
import type { Db } from '../db/index.js';
import { DB } from '../tokens.js';
import { enabledModules } from './enabled.js';
import { installed } from './installed.js';

/** Маршруты модуля живут под /api/<id>/…; выключенный модуль → 404 module_disabled. */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const url = context.switchToHttp().getRequest<FastifyRequest>().url;
    const id = /^\/api\/([^/?]+)/.exec(url)?.[1];
    if (id && installed.some((m) => m.api.id === id) && !(await enabledModules(this.db)).has(id)) {
      // C-modules v11: setup выключенного модуля — только сессия owner/admin
      if (new RegExp(`^/api/${id}/setup(?:[/?]|$)`).test(url)) {
        const a = getAuth(context.switchToHttp().getRequest());
        if (a.via === 'token' || (a.role !== 'owner' && a.role !== 'admin'))
          throw new HttpError(403, 'forbidden', 'Нужна роль владельца или администратора');
        return true;
      }
      throw new HttpError(404, 'module_disabled', `Модуль ${id} выключен`);
    }
    return true;
  }
}

@Controller('api/modules')
export class ModulesController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async list() {
    const on = await enabledModules(this.db);
    return {
      modules: await Promise.all(
        installed.map(async (m) => ({
          id: m.api.id,
          enabled: on.has(m.api.id),
          unavailable: (await m.api.unavailable?.(this.db)) ?? null,
        })),
      ),
    };
  }
}
