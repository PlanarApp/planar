import type { MaybeRefOrGetter } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ArrowRightLeft,
  CalendarDays,
  CircleDot,
  CopyPlus,
  ExternalLink,
  Flag,
  Hash,
  Link,
  Maximize2,
  Star,
  StarOff,
  Trash2,
  UserRound,
} from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import type { MenuItem } from '../ui/Menu.vue';
import { toast } from '../ui/toast';
import { db, useQuery } from '../sync';
import { useAuth } from '../auth/useAuth';
import { localToday } from '../views/filter';
import { addDays } from '../views/calendar/dates';
import { openTask } from '../views/open';
import { favorites } from '../layout/nav';
import { useMembers, useStatuses } from './dictionaries';
import { createTask, deleteTask, setAssignees, updateTask } from './ops';
import type { TaskView } from './queries';
import PriorityIcon from './fields/PriorityIcon.vue';
import StatusIcon from './fields/StatusIcon.vue';

const PRIORITIES = [1, 2, 3, 4, 0];

/**
 * Контекстное меню задачи (Список, Доска, Таблица): открыть, ссылка, статус, приоритет,
 * исполнители, срок, перенос в другой проект, дублировать, удалить. Справочники читаются один раз на вид.
 */
export function useTaskMenu(spaceId: MaybeRefOrGetter<string>) {
  const { t } = useI18n();
  const session = useAuth().user;
  const statuses = useStatuses(spaceId);
  const members = useMembers(spaceId);
  const projects = useQuery(() => db.table<Row<'projects'>>('projects').toArray());
  // сводка группы: spaceId — несколько пространств через запятую; статусы и проекты — пространства задачи
  const spaceProjects = (task: TaskView) =>
    (projects.value ?? []).filter((p) => p.spaceId === task.spaceId && !p.archivedAt);

  const copy = (text: string, note: string) =>
    navigator.clipboard?.writeText(text).then(() => toast(note, 2500));

  const due = (task: TaskView, d: string | null) => void updateTask(task.id, { dueDate: d });

  return (task: TaskView): MenuItem[] => {
    const me = session.value?.id;
    const today = localToday();
    return [
      {
        id: 'open',
        label: t('taskMenu.open'),
        icon: Maximize2,
        onSelect: () => openTask(task.key),
      },
      {
        id: 'tab',
        label: t('taskMenu.newTab'),
        icon: ExternalLink,
        onSelect: () => void window.open(`/t/${task.key}`, '_blank'),
      },
      {
        id: 'link',
        label: t('taskMenu.copyLink'),
        icon: Link,
        onSelect: () =>
          void copy(new URL(`/t/${task.key}`, location.origin).href, t('sidebar.linkCopied')),
      },
      {
        id: 'key',
        label: t('taskMenu.copyId', { key: task.key }),
        icon: Hash,
        onSelect: () => void copy(task.key, t('taskMenu.idCopied')),
      },
      {
        id: 'fav',
        label: t(favorites.has('task', task.id) ? 'sidebar.unfavorite' : 'sidebar.favorite'),
        icon: favorites.has('task', task.id) ? StarOff : Star,
        onSelect: () =>
          favorites.toggle({ kind: 'task', id: task.id, name: task.title, to: `/t/${task.key}` }),
      },
      { separator: true },
      {
        id: 'status',
        label: t('tasks.status'),
        icon: CircleDot,
        children: (statuses.value ?? [])
          .filter((s) => s.spaceId === task.spaceId)
          .map((s) => ({
            id: s.id,
            label: s.name,
            icon: StatusIcon,
            iconProps: { status: s },
            checked: s.id === task.statusId,
            onSelect: () => void updateTask(task.id, { statusId: s.id }),
          })),
      },
      {
        id: 'priority',
        label: t('tasks.priorityTitle'),
        icon: Flag,
        children: PRIORITIES.map((p) => ({
          id: String(p),
          label: t(`tasks.priority.${p}`),
          icon: PriorityIcon,
          iconProps: { priority: p },
          checked: p === task.priority,
          onSelect: () => void updateTask(task.id, { priority: p }),
        })),
      },
      {
        id: 'assignee',
        label: t('tasks.assignee'),
        icon: UserRound,
        children: [
          ...(me && !task.assigneeIds.includes(me)
            ? [
                {
                  id: 'me',
                  label: t('taskMenu.assignMe'),
                  onSelect: () => void setAssignees(task.id, [...task.assigneeIds, me]),
                },
              ]
            : []),
          ...(members.value ?? []).map((u) => {
            const on = task.assigneeIds.includes(u.id);
            return {
              id: u.id,
              label: u.name,
              checked: on,
              onSelect: () =>
                void setAssignees(
                  task.id,
                  on ? task.assigneeIds.filter((x) => x !== u.id) : [...task.assigneeIds, u.id],
                ),
            };
          }),
        ],
      },
      {
        id: 'due',
        label: t('taskMenu.due'),
        icon: CalendarDays,
        children: [
          {
            id: 'today',
            label: t('taskMenu.today'),
            checked: task.dueDate === today,
            onSelect: () => due(task, today),
          },
          {
            id: 'tomorrow',
            label: t('taskMenu.tomorrow'),
            onSelect: () => due(task, addDays(today, 1)),
          },
          {
            id: 'week',
            label: t('taskMenu.nextWeek'),
            onSelect: () => due(task, addDays(today, 7)),
          },
          {
            id: 'none',
            label: t('taskMenu.noDue'),
            checked: !task.dueDate,
            onSelect: () => due(task, null),
          },
        ],
      },
      {
        id: 'move',
        label: t('taskMenu.move'),
        icon: ArrowRightLeft,
        disabled: spaceProjects(task).length < 2,
        children: spaceProjects(task).map((p) => ({
          id: p.id,
          label: p.name,
          checked: p.id === task.projectId,
          onSelect: () => p.id !== task.projectId && void updateTask(task.id, { projectId: p.id }),
        })),
      },
      { separator: true },
      {
        id: 'dup',
        label: t('taskMenu.duplicate'),
        icon: CopyPlus,
        onSelect: () =>
          void createTask({
            projectId: task.projectId,
            statusId: task.statusId,
            title: t('taskMenu.copyOf', { title: task.title }),
            after: task.rank,
            before: null,
            parentId: task.parentId,
            priority: task.priority,
            dueDate: task.dueDate,
            assigneeIds: task.assigneeIds,
            labelIds: task.labelIds,
          }),
      },
      {
        id: 'delete',
        label: t('list.delete'),
        icon: Trash2,
        danger: true,
        confirm: {
          title: t('list.deleteTitle'),
          description: t('list.deleteText', { n: 1 }),
          confirmLabel: t('list.delete'),
        },
        onSelect: () => void deleteTask(task.id),
      },
    ];
  };
}
