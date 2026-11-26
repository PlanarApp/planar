import { z } from 'zod';
import { uuidv7 } from '@planar/shared';
import type { ExtArea, ExtOp } from './types.js';
import {
  copyPairs,
  lastProjectRank,
  lastSpaceRank,
  projectMemberRow,
  projectMembers,
  projectRow,
  spaceMemberRow,
  spaceMembers,
  spaceRow,
  visibleSpace,
} from './spaces.service.js';

// PLNRAPP-272 (part 1): spaces, projects, members and roles over the existing mutators; rights — of the mutators
const role = z.enum(['admin', 'member', 'guest']);
const id = z.uuid();
const color = z.string();
const spaceFields = {
  description: z.string().nullable().optional(),
  color: color.nullable().optional(),
  icon: z.string().nullable().optional(),
  leadId: id.nullable().optional(),
};
const projectFields = {
  description: z.string().nullable().optional(),
  color: color.nullable().optional(),
  icon: z.string().nullable().optional(),
  leadId: id.nullable().optional(),
  defaultAssigneeId: id.nullable().optional(),
};

const ops: ExtOp[] = [
  {
    tool: 'create_space',
    description:
      'Создать пространство (вы станете его админом): название, описание, цвет, иконка, руководитель',
    method: 'post',
    path: '/api/v1/spaces',
    shape: { name: z.string().min(1).max(100), ...spaceFields },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const { name, ...rest } = i as { name: string } & Record<string, unknown>;
      const sid = uuidv7();
      const muts = [
        {
          name: 'space.create',
          args: { id: sid, name, rank: await lastSpaceRank(d), memberId: uuidv7() },
        },
      ];
      if (Object.values(rest).some((v) => v !== undefined))
        muts.push({ name: 'space.update', args: { id: sid, ...rest } } as never);
      await d.run(u, muts, t);
      return spaceRow(d, sid);
    },
  },
  {
    tool: 'update_space',
    description: 'Изменить пространство: название, описание, цвет, иконка, руководитель',
    method: 'patch',
    path: '/api/v1/spaces/{id}',
    shape: { id, name: z.string().min(1).max(100).optional(), ...spaceFields },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await visibleSpace(d, u, a.id);
      await d.run(u, [{ name: 'space.update', args: a }], t);
      return spaceRow(d, a.id);
    },
  },
  {
    tool: 'delete_space',
    description:
      'Удалить пространство. Без withContent — только пустое; withContent=true удаляет и проекты с задачами (необратимо)',
    method: 'delete',
    path: '/api/v1/spaces/{id}',
    shape: { id, withContent: z.stringbool().optional() },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const a = i as { id: string; withContent?: boolean };
      await visibleSpace(d, u, a.id);
      await d.run(u, [{ name: 'space.delete', args: a }], t);
    },
  },
  {
    tool: 'list_space_members',
    description: 'Участники пространства: id записи, userId, логин, имя, роль (admin/member/guest)',
    method: 'get',
    path: '/api/v1/spaces/{id}/members',
    shape: { id },
    write: false,
    run: async (d, u, i) => {
      const a = i as { id: string };
      await visibleSpace(d, u, a.id);
      return spaceMembers(d, a.id);
    },
  },
  {
    tool: 'set_space_members_mode',
    description:
      'Режим состава пространства: inherit — как в Воркспейсе (корневом пространстве); custom — свой состав members [{userId, role}] (непустой, есть admin). Корневое пространство — источник, режим не меняется',
    method: 'put',
    path: '/api/v1/spaces/{id}/members',
    shape: {
      id,
      mode: z.enum(['inherit', 'custom']),
      members: z.array(z.object({ userId: id, role })).optional(),
    },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string; mode: string; members?: { userId: string; role: string }[] };
      await visibleSpace(d, u, a.id);
      await d.run(
        u,
        [
          {
            name: 'space.setMembersMode',
            args: {
              spaceId: a.id,
              mode: a.mode,
              members: a.members?.map((m) => ({ ...m, id: uuidv7() })),
            },
          },
        ],
        t,
      );
      return {
        membersMode: (await spaceRow(d, a.id)).membersMode,
        members: await spaceMembers(d, a.id),
      };
    },
  },
  {
    tool: 'add_space_member',
    description:
      'Добавить пользователя в пространство с ролью (admin/member/guest); состав должен быть свой (custom)',
    method: 'post',
    path: '/api/v1/spaces/{id}/members',
    shape: { id, userId: id, role },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const a = i as { id: string; userId: string; role: string };
      await visibleSpace(d, u, a.id);
      const mid = uuidv7();
      await d.run(
        u,
        [{ name: 'member.add', args: { id: mid, spaceId: a.id, userId: a.userId, role: a.role } }],
        t,
      );
      return (await spaceMembers(d, a.id)).find((m) => m.id === mid);
    },
  },
  {
    tool: 'update_space_member',
    description: 'Сменить роль участника пространства (userId — пользователь)',
    method: 'patch',
    path: '/api/v1/spaces/{id}/members/{userId}',
    shape: { id, userId: id, role },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string; userId: string; role: string };
      await visibleSpace(d, u, a.id);
      const mid = await spaceMemberRow(d, a.id, a.userId);
      await d.run(u, [{ name: 'member.update', args: { id: mid, role: a.role } }], t);
      return (await spaceMembers(d, a.id)).find((m) => m.id === mid);
    },
  },
  {
    tool: 'remove_space_member',
    description: 'Убрать участника из пространства (и из составов его проектов)',
    method: 'delete',
    path: '/api/v1/spaces/{id}/members/{userId}',
    shape: { id, userId: id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const a = i as { id: string; userId: string };
      await visibleSpace(d, u, a.id);
      await d.run(
        u,
        [{ name: 'member.remove', args: { id: await spaceMemberRow(d, a.id, a.userId) } }],
        t,
      );
    },
  },
  {
    tool: 'create_project',
    description:
      'Создать проект в пространстве: название, ключ (A–Z0-9, 2–10), описание, цвет, иконка, руководитель, исполнитель по умолчанию, модули данных; copyFromProjectId — скопировать статусы и метки из проекта того же пространства',
    method: 'post',
    path: '/api/v1/projects',
    shape: {
      spaceId: id,
      name: z.string().min(1).max(100),
      key: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
      ...projectFields,
      modules: z.array(z.string()).optional(),
      copyFromProjectId: id.optional(),
    },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const { copyFromProjectId, ...a } = i as { spaceId: string; copyFromProjectId?: string };
      await visibleSpace(d, u, a.spaceId);
      const pid = uuidv7();
      const args: Record<string, unknown> = {
        ...a,
        id: pid,
        rank: await lastProjectRank(d, a.spaceId),
      };
      if (copyFromProjectId)
        args.copyFrom = {
          projectId: await d.visibleProject(u, copyFromProjectId),
          ...(await copyPairs(d, copyFromProjectId)),
        };
      else args.statusIds = Array.from({ length: 5 }, () => uuidv7());
      await d.run(u, [{ name: 'project.create', args }], t);
      return projectRow(d, pid);
    },
  },
  {
    tool: 'delete_project',
    description: 'Удалить проект (админ проекта); только без задач (необратимо)',
    method: 'delete',
    path: '/api/v1/projects/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await d.visibleProject(u, a.id);
      await d.run(u, [{ name: 'project.delete', args: a }], t);
    },
  },
  {
    tool: 'move_project',
    description:
      'Перенести проект со всеми задачами в другое пространство (в конец списка); кто не участник нового пространства — теряет роль в проекте, назначения и наблюдение',
    method: 'post',
    path: '/api/v1/projects/{id}/move',
    shape: { id, spaceId: id },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string; spaceId: string };
      await d.visibleProject(u, a.id);
      await visibleSpace(d, u, a.spaceId);
      const rank = await lastProjectRank(d, a.spaceId);
      await d.run(u, [{ name: 'project.move', args: { ...a, rank } }], t);
      return projectRow(d, a.id);
    },
  },
  {
    tool: 'copy_project_dictionaries',
    description:
      'Скопировать в проект все статусы и метки другого проекта того же пространства (одноимённые пропускаются)',
    method: 'post',
    path: '/api/v1/projects/{id}/copy-dictionaries',
    shape: { id, fromProjectId: id },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string; fromProjectId: string };
      await d.visibleProject(u, a.id);
      await d.visibleProject(u, a.fromProjectId);
      await d.run(
        u,
        [
          {
            name: 'project.copyDictionaries',
            args: {
              projectId: a.id,
              fromProjectId: a.fromProjectId,
              ...(await copyPairs(d, a.fromProjectId)),
            },
          },
        ],
        t,
      );
      return projectRow(d, a.id);
    },
  },
  {
    tool: 'list_project_members',
    description:
      'Кто имеет доступ к проекту и с какой ролью (по правилам проекта), и режим состава membersMode: inherit/custom',
    method: 'get',
    path: '/api/v1/projects/{id}/members',
    shape: { id },
    write: false,
    run: async (d, u, i) => projectMembers(d, await d.visibleProject(u, (i as { id: string }).id)),
  },
  {
    tool: 'set_project_members_mode',
    description:
      'Режим состава проекта: inherit — как в пространстве; custom — свой состав members [{userId, role}] (непустой, участники пространства)',
    method: 'put',
    path: '/api/v1/projects/{id}/members',
    shape: {
      id,
      mode: z.enum(['inherit', 'custom']),
      members: z.array(z.object({ userId: id, role })).optional(),
    },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string; mode: string; members?: { userId: string; role: string }[] };
      await d.visibleProject(u, a.id);
      await d.run(
        u,
        [
          {
            name: 'project.setMembersMode',
            args: {
              projectId: a.id,
              mode: a.mode,
              members: a.members?.map((m) => ({ ...m, id: uuidv7() })),
            },
          },
        ],
        t,
      );
      return projectMembers(d, a.id);
    },
  },
  {
    tool: 'add_project_member',
    description:
      'Добавить участника в свой состав проекта (режим custom): userId из пространства, роль',
    method: 'post',
    path: '/api/v1/projects/{id}/members',
    shape: { id, userId: id, role },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const a = i as { id: string; userId: string; role: string };
      await d.visibleProject(u, a.id);
      await d.run(
        u,
        [
          {
            name: 'projectMember.add',
            args: { id: uuidv7(), projectId: a.id, userId: a.userId, role: a.role },
          },
        ],
        t,
      );
      return (await projectMembers(d, a.id)).members.find((m) => m.userId === a.userId);
    },
  },
  {
    tool: 'update_project_member',
    description: 'Сменить роль участника проекта (режим custom)',
    method: 'patch',
    path: '/api/v1/projects/{id}/members/{userId}',
    shape: { id, userId: id, role },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string; userId: string; role: string };
      await d.visibleProject(u, a.id);
      const mid = await projectMemberRow(d, a.id, a.userId);
      await d.run(u, [{ name: 'projectMember.setRole', args: { id: mid, role: a.role } }], t);
      return (await projectMembers(d, a.id)).members.find((m) => m.userId === a.userId);
    },
  },
  {
    tool: 'remove_project_member',
    description: 'Убрать участника из своего состава проекта (режим custom)',
    method: 'delete',
    path: '/api/v1/projects/{id}/members/{userId}',
    shape: { id, userId: id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const a = i as { id: string; userId: string };
      await d.visibleProject(u, a.id);
      await d.run(
        u,
        [{ name: 'projectMember.remove', args: { id: await projectMemberRow(d, a.id, a.userId) } }],
        t,
      );
    },
  },
];

export const area: ExtArea = { name: 'spaces', ops };
