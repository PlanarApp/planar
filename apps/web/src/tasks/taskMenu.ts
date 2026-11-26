import type { Component, MaybeRefOrGetter } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  CalendarDays,
  CircleDot,
  Copy,
  CopyPlus,
  ExternalLink,
  Flag,
  GitMerge,
  Hash,
  Link,
  Maximize2,
  PanelRight,
  Star,
  StarOff,
  Trash2,
  UserRound,
} from '@lucide/vue';
import type { MenuItem } from '../ui/Menu.vue';
import { toast } from '../ui/toast';
import { openTask } from '../views/open';
import { favorites } from '../layout/nav';
import { useProjectAdmin } from './admin';
import { archiveTask, createTask, deleteTask, restoreTask } from './ops';
import { mergeFrom } from './merge';
import { moveTarget } from './move';
import { moveMenu, useMoveSpaces } from './moveTargets';
import type { TaskView } from './queries';

/** a value field the menu opens the picker of */
export type TaskMenuField = 'status' | 'priority' | 'assignee' | 'dates';

/**
 * Task context menu (List, Board, Table): open, copy, the value fields (their pickers), move to another project,
 * duplicate, merge, archive, delete (always confirmed, cannot be undone). Dictionaries are read once per view.
 */
export function useTaskMenu(
  spaceId: MaybeRefOrGetter<string>,
  openField?: (field: TaskMenuField, task: TaskView) => void,
) {
  const { t } = useI18n();
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

  // the value fields open their picker (the List, Board, Table menu); without openField (the task form, where the
  // fields are on screen) they are not in the menu
  const fieldItem = (
    task: TaskView,
    field: TaskMenuField,
    label: string,
    icon: Component,
  ): MenuItem[] =>
    openField ? [{ id: field, label, icon, onSelect: () => openField(field, task) }] : [];

  return (task: TaskView): MenuItem[] => {
    return [
      {
        id: 'open',
        label: t('taskMenu.open'),
        icon: Maximize2,
        actions: [
          {
            id: 'open',
            label: t('taskMenu.openHere'),
            icon: PanelRight,
            onSelect: () => openTask(task.key),
          },
          {
            id: 'tab',
            label: t('taskMenu.newTab'),
            icon: ExternalLink,
            onSelect: () => void window.open(`/t/${task.key}`, '_blank'),
          },
        ],
      },
      {
        id: 'copy',
        label: t('taskMenu.copy'),
        icon: Copy,
        actions: [
          {
            id: 'link',
            label: t('taskMenu.copyLink'),
            icon: Link,
            onSelect: () =>
              void copy(new URL(`/t/${task.key}`, location.origin).href, t('sidebar.linkCopied')),
          },
          {
            id: 'key',
            label: t('taskMenu.copyKey', { key: task.key }),
            icon: Hash,
            onSelect: () => void copy(task.key, t('taskMenu.idCopied')),
          },
        ],
      },
      {
        id: 'fav',
        label: t(favorites.has('task', task.id) ? 'sidebar.unfavorite' : 'sidebar.favorite'),
        icon: favorites.has('task', task.id) ? StarOff : Star,
        onSelect: () =>
          favorites.toggle({ kind: 'task', id: task.id, name: task.title, to: `/t/${task.key}` }),
      },
      { separator: true },
      ...fieldItem(task, 'status', t('tasks.status'), CircleDot),
      ...fieldItem(task, 'priority', t('tasks.priorityTitle'), Flag),
      ...fieldItem(task, 'assignee', t('tasks.assignee'), UserRound),
      ...fieldItem(task, 'dates', t('taskMenu.due'), CalendarDays),
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
            // undo — restoring, which only an admin of the project may do
            onSelect: () =>
              void archiveTask(task.id).then(() =>
                toast(
                  t('archive.archived'),
                  10000,
                  admin(task.spaceId, task.projectId)
                    ? { label: t('archive.undo'), run: () => void restoreTask(task.id) }
                    : undefined,
                ),
              ),
          },
      ...(admin(task.spaceId, task.projectId)
        ? [
            {
              id: 'delete',
              label: t('list.delete'),
              icon: Trash2,
              danger: true,
              confirm: {
                title: t('task.deleteTitle'),
                description: t('task.deleteText'),
                confirmLabel: t('list.delete'),
              },
              onSelect: () => void deleteTask(task.id),
            },
          ]
        : []),
    ];
  };
}
