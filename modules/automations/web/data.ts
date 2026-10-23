import { i18n, mutate } from '@planar/web/modules';
import type { Action, Run, Trigger } from '../shared/index.js';

/** Мутаторы модуля регистрирует клиент синхронизации (session.ts). */
export const run = (name: string, args: Record<string, unknown>): Promise<void> =>
  mutate(name, args);

/** Журнал запусков правила (новые сверху). */
export async function fetchRuns(ruleId: string, fetcher = globalThis.fetch): Promise<Run[]> {
  const r = await fetcher(`/api/automations/rules/${ruleId}/runs?limit=50`, {
    credentials: 'include',
  });
  if (!r.ok) throw new Error(String(r.status));
  return ((await r.json()) as { data: Run[] }).data;
}

export const TRIGGERS = [
  'task.created',
  'task.status_changed',
  'task.assignee_changed',
  'task.field_changed',
  'task.due',
  'comment.added',
] as const;
export const ACTIONS = [
  'set_status',
  'assign',
  'unassign',
  'add_label',
  'remove_label',
  'set_field',
  'add_comment',
  'move_to_project',
  'create_subtask',
  'send_webhook',
] as const;

export const blankTrigger = (type: Trigger['type']): Trigger =>
  type === 'task.field_changed'
    ? { type, field: 'priority' }
    : type === 'task.due'
      ? { type, daysBefore: 1 }
      : ({ type } as Trigger);

export const blankAction = (type: Action['type']): Action => {
  switch (type) {
    case 'set_status':
      return { type, statusId: '' };
    case 'assign':
    case 'unassign':
      return { type, userId: '' };
    case 'add_label':
    case 'remove_label':
      return { type, labelId: '' };
    case 'set_field':
      return { type, field: 'priority', value: 0 };
    case 'add_comment':
      return { type, text: '' };
    case 'move_to_project':
      return { type, projectId: '' };
    case 'create_subtask':
      return { type, title: '' };
    case 'send_webhook':
      return { type, subscriptionId: '' };
  }
};

const TEXT = {
  ru: {
    title: 'Автоматизации',
    project: 'Проект',
    rules: 'Правила',
    none: 'Правил нет',
    add: 'Новое правило',
    name: 'Название',
    enabled: 'Включено',
    trigger: 'Когда',
    conditions: 'Если',
    actions: 'Тогда',
    addCondition: 'Добавить условие',
    addAction: 'Добавить действие',
    save: 'Сохранить',
    cancel: 'Отмена',
    delete: 'Удалить',
    edit: 'Изменить',
    log: 'Журнал запусков',
    logEmpty: 'Запусков не было',
    from: 'Из статусов (id через запятую)',
    to: 'В статусы (id через запятую)',
    user: 'Пользователь',
    field: 'Поле',
    value: 'Значение',
    subscription: 'ID подписки вебхука',
    daysBefore: 'За сколько дней до срока',
    invalid: 'Правило заполнено неверно',
    triggers: {
      'task.created': 'Задача создана',
      'task.status_changed': 'Статус изменился',
      'task.assignee_changed': 'Исполнитель изменился',
      'task.field_changed': 'Поле изменилось',
      'task.due': 'Приближается срок',
      'comment.added': 'Добавлен комментарий',
    },
    actionNames: {
      set_status: 'Сменить статус',
      assign: 'Назначить',
      unassign: 'Снять исполнителя',
      add_label: 'Добавить метку',
      remove_label: 'Убрать метку',
      set_field: 'Установить поле',
      add_comment: 'Комментарий',
      move_to_project: 'Перенести в проект',
      create_subtask: 'Создать подзадачу',
      send_webhook: 'Отправить вебхук',
    },
    status: { ok: 'выполнено', skipped: 'пропущено', error: 'ошибка' },
    op: {
      in: 'один из',
      notIn: 'не один из',
      isEmpty: 'пусто',
      isNotEmpty: 'не пусто',
      before: 'раньше',
      after: 'позже',
      contains: 'содержит',
      gte: '≥',
      lte: '≤',
    },
  },
  en: {
    title: 'Automations',
    project: 'Project',
    rules: 'Rules',
    none: 'No rules',
    add: 'New rule',
    name: 'Name',
    enabled: 'Enabled',
    trigger: 'When',
    conditions: 'If',
    actions: 'Then',
    addCondition: 'Add condition',
    addAction: 'Add action',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    log: 'Run log',
    logEmpty: 'No runs yet',
    from: 'From statuses (ids, comma separated)',
    to: 'To statuses (ids, comma separated)',
    user: 'User',
    field: 'Field',
    value: 'Value',
    subscription: 'Webhook subscription ID',
    daysBefore: 'Days before due date',
    invalid: 'The rule is not valid',
    triggers: {
      'task.created': 'Task created',
      'task.status_changed': 'Status changed',
      'task.assignee_changed': 'Assignee changed',
      'task.field_changed': 'Field changed',
      'task.due': 'Due date approaching',
      'comment.added': 'Comment added',
    },
    actionNames: {
      set_status: 'Set status',
      assign: 'Assign',
      unassign: 'Unassign',
      add_label: 'Add label',
      remove_label: 'Remove label',
      set_field: 'Set field',
      add_comment: 'Comment',
      move_to_project: 'Move to project',
      create_subtask: 'Create subtask',
      send_webhook: 'Send webhook',
    },
    status: { ok: 'ok', skipped: 'skipped', error: 'error' },
    op: {
      in: 'is one of',
      notIn: 'is not one of',
      isEmpty: 'is empty',
      isNotEmpty: 'is not empty',
      before: 'before',
      after: 'after',
      contains: 'contains',
      gte: '≥',
      lte: '≤',
    },
  },
};
export type Text = (typeof TEXT)['ru'];
/** Тексты модуля на текущем языке интерфейса. */
export const text = (): Text => TEXT[i18n.global.locale.value as 'ru' | 'en'] ?? TEXT.ru;
