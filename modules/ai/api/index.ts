import { Module } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ModuleHookApi, MutationWrite } from '@planar/server-kit';
import type { BackendModuleManifest } from '@planar/shared';
import { uuidv7 } from '@planar/shared';
import { AI_BOT_LOGIN, AI_BOT_NAME, shared } from '../shared/index.js';
import { AiController } from './controller.js';

@Module({ controllers: [AiController] })
class AiModule {}

export { resolveConnection, secretOf } from './connections.js';
export { generateStructured, checkConnection, costOf, type LlmConnection } from './llm.js';

const has = (r: Record<string, unknown> | null | undefined) =>
  ((r?.modules as string[] | undefined) ?? []).includes('ai');

/**
 * A project got the module: the bot «ИИ» (an active user `ai`, users.bot) exists and is a member of the
 * project's space with the role member, and of the project itself when its members are its own.
 */
async function afterMutation(writes: MutationWrite[], ctx: { now: string }, api: ModuleHookApi) {
  for (const w of writes) {
    if (w.entity !== 'projects' || !w.after || !has(w.after) || has(w.before)) continue;
    const bot = await api.ensureBotUser(AI_BOT_LOGIN, AI_BOT_NAME);
    const spaceId = w.after.spaceId as string;
    const projectId = w.after.id as string;
    const member = async (table: 'space_members' | 'project_members', col: string, id: string) =>
      (
        await api.q.execute(
          sql`select 1 from ${sql.identifier(table)} where ${sql.identifier(col)} = ${id}::uuid and user_id = ${bot}::uuid`,
        )
      ).rows.length > 0;
    const row = {
      spaceId,
      userId: bot,
      role: 'member' as const,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    if (!(await member('space_members', 'space_id', spaceId)))
      await api.sys.put('spaceMembers', { id: uuidv7(), ...row });
    if (
      w.after.membersMode === 'custom' &&
      !(await member('project_members', 'project_id', projectId))
    )
      await api.sys.put('projectMembers', { id: uuidv7(), projectId, ...row });
  }
}

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: AiModule,
  mutators: shared.mutators,
  entities: shared.entities,
  afterMutation: afterMutation as BackendModuleManifest['afterMutation'],
};
