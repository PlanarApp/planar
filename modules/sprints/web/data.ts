import { effectScope, getCurrentScope, onScopeDispose, shallowRef, toValue, watch } from 'vue';
import type { EffectScope } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import type { Row } from '@planar/shared';
import { i18n } from '../../../apps/web/src/i18n';
import { db, mutate, registerMutators, useQuery } from '../../../apps/web/src/sync';
import { shared, todayIn, type Cycle, type Settings } from '../shared/index.js';

export const hasTables = () => db.tables.some((t) => t.name === 'sprintsCycles');

/** Мутаторы модуля регистрируются в клиенте при первом использовании (повторная регистрация — Error). */
export function run(name: string, args: Record<string, unknown>): Promise<void> {
  try {
    registerMutators(shared.mutators);
  } catch {
    /* уже зарегистрированы */
  }
  return mutate(name, args);
}

export const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export interface SprintData {
  settings: Settings | null;
  cycles: Cycle[];
  /** задачи проекта с циклом */
  tasks: Row<'tasks'>[];
}

/** Живые данные проекта: настройки, циклы, задачи в циклах. */
export function useSprintData(projectId: MaybeRefOrGetter<string>) {
  const r = shallowRef<SprintData>();
  let scope: EffectScope | undefined;
  watch(
    () => toValue(projectId),
    (id) => {
      scope?.stop();
      r.value = undefined;
      scope = effectScope();
      scope.run(() => {
        const q = useQuery(async (): Promise<SprintData> => {
          if (!hasTables()) return { settings: null, cycles: [], tasks: [] };
          const [settings, cycles, tasks] = await Promise.all([
            db.table<Settings>('sprintsSettings').get(id),
            db.table<Cycle>('sprintsCycles').where('projectId').equals(id).toArray(),
            db.table<Row<'tasks'>>('tasks').where('projectId').equals(id).toArray(),
          ]);
          return {
            settings: settings ?? null,
            cycles: cycles.sort((a, b) => a.number - b.number),
            tasks: tasks.filter((t) => t.cycleId),
          };
        });
        watch(q, (v) => (r.value = v), { immediate: true, flush: 'sync' });
      });
    },
    { immediate: true, flush: 'sync' },
  );
  if (getCurrentScope()) onScopeDispose(() => scope?.stop());
  return r;
}

/** Текущий цикл: незакрытый, сегодня (в поясе проекта) внутри дат. */
export const currentCycle = (cycles: Cycle[], tz: string): Cycle | undefined => {
  const today = todayIn(tz);
  return cycles.find((c) => !c.closedAt && c.startDate <= today && today <= c.endDate);
};

const TEXT = {
  ru: {
    title: 'Спринт',
    none: 'Нет текущего цикла',
    enable: 'Включить спринты',
    settings: 'Настройки',
    length: 'Длина по умолчанию, дней',
    timezone: 'Часовой пояс',
    autoCreate: 'Создавать следующий цикл при закрытии',
    enabled: 'Спринты включены',
    create: 'Создать цикл',
    close: 'Закрыть цикл',
    progress: 'Прогресс',
    burnup: 'Burn-up',
    scope: 'Объём',
    done: 'Сделано',
    tasks: 'задач',
    cycle: 'Спринт',
    noCycle: 'Без спринта',
    badTz: 'Неверный часовой пояс',
    cat: {
      backlog: 'Бэклог',
      todo: 'К выполнению',
      in_progress: 'В работе',
      done: 'Готово',
      cancelled: 'Отменено',
    },
  },
  en: {
    title: 'Sprint',
    none: 'No current cycle',
    enable: 'Enable sprints',
    settings: 'Settings',
    length: 'Default length, days',
    timezone: 'Time zone',
    autoCreate: 'Create the next cycle on close',
    enabled: 'Sprints enabled',
    create: 'Create cycle',
    close: 'Close cycle',
    progress: 'Progress',
    burnup: 'Burn-up',
    scope: 'Scope',
    done: 'Done',
    tasks: 'tasks',
    cycle: 'Sprint',
    noCycle: 'No sprint',
    badTz: 'Invalid time zone',
    cat: {
      backlog: 'Backlog',
      todo: 'Todo',
      in_progress: 'In progress',
      done: 'Done',
      cancelled: 'Cancelled',
    },
  },
};
export type Text = (typeof TEXT)['ru'];
/** Тексты модуля на текущем языке интерфейса. */
export const text = (): Text => TEXT[i18n.global.locale.value as 'ru' | 'en'] ?? TEXT.ru;
