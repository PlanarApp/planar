import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { createI18n } from 'vue-i18n';
import en from '../../i18n/en';
import ru from '../../i18n/ru';

vi.mock('../progress', () => ({
  useTaskProgress: () => ref({ subtasks: { done: 1, total: 2 }, checklist: { done: 0, total: 0 } }),
}));
const TaskProgress = (await import('../TaskProgress.vue')).default;
const { useAuth } = await import('../../auth/useAuth');
const ME = '00000000-0000-7000-8000-000000000001';
const OTHER = '00000000-0000-7000-8000-000000000002';
beforeEach(() => {
  useAuth().user.value = { id: ME } as never;
});

// PLNRAPP-577: assigned comments «resolved/total» next to the subtasks on a list row / board card
type C = { total: number; resolved: number; assignedToMe: boolean };
/** the tasks row counters as the projection gives them (open assignees — me or someone else) */
const row = (c?: C) =>
  c && {
    commentsAssigned: c.total,
    commentsResolved: c.resolved,
    commentsOpenAssignees: c.assignedToMe ? [ME] : c.total > c.resolved ? [OTHER] : [],
  };
const show = (comments?: C) =>
  mount(
    {
      components: { TaskProgress },
      props: ['c'],
      template: '<div @click="$emit(\'hit\')"><TaskProgress task-id="t" :comments="c" /></div>',
    },
    {
      props: { c: row(comments) },
      global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
    },
  );

describe('TaskProgress: assigned comments', () => {
  it('no assigned comments — no indicator', () => {
    expect(show().find('[data-testid=row-comments]').exists()).toBe(false);
    const w = show({ total: 0, resolved: 0, assignedToMe: false });
    expect(w.find('[data-testid=row-comments]').exists()).toBe(false);
    expect(w.find('[data-testid=row-children]').exists()).toBe(true);
  });
  it('resolved/total right after the subtasks; not mine — no accent', () => {
    const w = show({ total: 3, resolved: 1, assignedToMe: false });
    const chips = w.findAll('span[data-testid]').map((s) => s.attributes('data-testid'));
    expect(chips).toEqual(['row-children', 'row-comments']);
    const c = w.get('[data-testid=row-comments]');
    expect(c.text()).toBe('1/3');
    expect(c.classes()).toContain('text-fg-muted');
    expect(c.attributes('data-mine')).toBeUndefined();
    expect(
      show({ total: 2, resolved: 2, assignedToMe: false })
        .get('[data-testid=row-comments]')
        .classes(),
    ).toContain('text-success');
  });
  it('an open comment assigned to me — accent', () => {
    const c = show({ total: 2, resolved: 1, assignedToMe: true }).get('[data-testid=row-comments]');
    expect(c.attributes('data-mine')).toBe('true');
    expect(c.classes()).toEqual(expect.arrayContaining(['text-accent', 'border-accent']));
  });
  it('the click does nothing (does not reach the row / card)', async () => {
    const w = show({ total: 1, resolved: 0, assignedToMe: true });
    await w.get('[data-testid=row-comments]').trigger('click');
    expect(w.emitted('hit')).toBeUndefined();
    await w.get('[data-testid=row-children]').trigger('click');
    expect(w.emitted('hit')).toHaveLength(1);
  });
  it('the accent appears when the user is loaded after the projection (full page load)', async () => {
    useAuth().user.value = null;
    const w = show({ total: 1, resolved: 0, assignedToMe: true });
    const c = () => w.get('[data-testid=row-comments]');
    expect(c().attributes('data-mine')).toBeUndefined();
    expect(c().text()).toBe('0/1');
    useAuth().user.value = { id: ME } as never;
    await nextTick();
    expect(c().attributes('data-mine')).toBe('true');
    expect(c().classes()).toContain('text-accent');
    useAuth().user.value = { id: OTHER } as never; // another user — the comment is not mine
    await nextTick();
    expect(c().attributes('data-mine')).toBeUndefined();
  });
});
