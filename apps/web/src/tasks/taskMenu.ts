import type { MaybeRefOrGetter } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  CalendarDays,
  CircleDot,
  CopyPlus,
  ExternalLink,
  Flag,
  GitMerge,
  Hash,
  Link,
  Maximize2,
  Star,
  StarOff,
  Sun,
  Trash2,
  UserRound,
} from 'lucide-vue-next';
import type { MenuItem } from '../ui/Menu.vue';
import { toast } from '../ui/toast';
import { useAuth } from '../auth/useAuth';
import { localToday } from '../views/filter';
import { addDays } from '../views/calendar/dates';
import { openTask } from '../views/open';
import { favorites } from '../layout/nav';
import { planToday, unplan, useMyDay } from '../inbox/myDay';
import { useMembers, useStatuses } from './dictionaries';
import { useProjectAdmin } from './admin';
import { archiveTask, createTask, deleteTask, restoreTask, setAssignees, updateTask } from './ops';
import { mergeFrom } from './merge';
import { moveTarget } from './move';
import { moveMenu, useMoveSpaces } from './moveTargets';
import type { TaskView } from './queries';
import PriorityIcon from './fields/PriorityIcon.vue';
import StatusIcon from './fields/StatusIcon.vue';

const PRIORITIES = [1, 2, 3, 4, 0];

/**
 * Task context menu (List, Board, Table): open, link, status, priority,
 * assignees, due date, move to another project, duplicate, merge, delete. Dictionaries are read once per view.
 */
export function useTaskMenu(spaceId: MaybeRefOrGetter<string>) {
  const { t } = useI18n();
  const session = useAuth().user;
  const statuses = useStatuses(spaceId);
  const members = useMembers(spaceId);
  const admin = useProjectAdmin();
  // move targets (PLNRAPP-519): spaces → projects I can change; the pick opens MoveTaskDialog
  const spaces = useMoveSpaces();
  const moveItem = (task: TaskView): MenuItem => {
    const { items, count } = moveMenu(
      spaces.value,
      { spaceId: task.spaceId, projectId: task.projectId },
      (spaceId, projectId) => {
        const s = spaces.value.find((x) => x.id === spaceId);
        const p = s?.projects.find((x) => x.id === projectId);
        if (!s || !p) return;
        moveTarget.value = {
          task: { id: task.id, key: task.key, statusId: task.statusId },
          spaceId,
          projectId: p.id,
          label: `${s.name} / ${p.name}`,
        };
      },
    );
    return {
      id: 'move',
      label: t('taskMenu.move'),
      icon: ArrowRightLeft,
      disabled: count < 2,
      children: items,
    };
  };

  const copy = (text: string, note: string) =>
    navigator.clipboard?.writeText(text).then(() => toast(note, 2500));

  const due = (task: TaskView, d: string | null) => void updateTask(task.id, { dueDate: d });

  // «My day» (PLANARAPP-10): add the task to today's plan or remove it
  const day = useMyDay(() => session.value?.id);
  const myDayItem = (task: TaskView): MenuItem => {
    const plan = day.value?.today.find((x) => x.task.id === task.id)?.plan;
    return {
      id: 'myDay',
      label: t(plan ? 'myDay.remove' : 'myDay.add'),
      icon: Sun,
      shortcut: 'D', // in the List, on the focused task (PLNRAPP-80)
      onSelect: () => void (plan ? unplan(plan.id) : planToday(task.id, day.value)),
    };
  };

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
      myDayItem(task),
      { separator: true },
      {
        id: 'status',
        label: t('tasks.status'),
        icon: CircleDot,
        children: (statuses.value ?? [])
          .filter((s) => s.projectId === task.projectId)
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
      moveItem(task),
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
        id: 'merge',
        label: t('taskMenu.merge'),
        icon: GitMerge,
        onSelect: () => (mergeFrom.value = task),
      },
      // PLNRAPP-155: archive — any member; out of the archive and delete — an admin of the project
      task.archivedAt
        ? {
            id: 'restore',
            label: t('archive.restore'),
            icon: ArchiveRestore,
            disabled: !admin(task.spaceId, task.projectId),
            onSelect: () => void restoreTask(task.id),
          }
        : {
            id: 'archive',
            label: t('archive.toArchive'),
            icon: Archive,
            onSelect: () =>
              void archiveTask(task.id).then(() => toast(t('archive.archived'), 2500)),
          },
      ...(admin(task.spaceId, task.projectId)
        ? [
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
          ]
        : []),
    ];
  };
}
