import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { TooltipProvider } from 'reka-ui';
import { defineComponent, h } from 'vue';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import AiStatusIcon from '../AiStatusIcon.vue';

type Props = InstanceType<typeof AiStatusIcon>['$props'];

// PLNRAPP-321: the compact AI status icon for a list row and a board card
const Empty = defineComponent({ render: () => null });
let w: VueWrapper | undefined;

async function render(props: Partial<Props> & Pick<Props, 'status'>, onRowClick = () => {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:p(.*)*', component: Empty }],
  });
  await router.push('/tasks');
  const i18n = createI18n({ legacy: false, locale: 'ru', messages: { ru, en } });
  w = mount(
    defineComponent({
      render: () =>
        h(TooltipProvider, null, () =>
          // the host row (a list row, a board card) opens the task on click
          h('div', { 'data-testid': 'row', onClick: onRowClick }, [
            h(AiStatusIcon, { runUrl: '/runs/r1', ...props }),
          ]),
        ),
    }),
    { attachTo: document.body, global: { plugins: [i18n, router] } },
  );
  await flushPromises();
  return { router };
}
const icon = () => w!.find('[data-testid="ai-status"]');
const at = (h: number, m: number) => new Date(2026, 10, 17, h, m).toISOString();

afterEach(() => {
  w?.unmount();
  w = undefined;
  document.body.innerHTML = '';
});

describe('AiStatusIcon', () => {
  it('running — спиннер и подсказка «ИИ работает с HH:MM»', async () => {
    await render({ status: 'running', startedAt: at(9, 5) });
    expect(icon().attributes('data-state')).toBe('running');
    expect(icon().find('svg.animate-spin').exists()).toBe(true);
    expect(icon().attributes('aria-label')).toBe('ИИ работает с 09:05');
    expect(icon().classes()).not.toContain('text-danger');
  });

  it('running без времени старта — «ИИ работает»', async () => {
    await render({ status: 'running' });
    expect(icon().attributes('aria-label')).toBe('ИИ работает');
  });

  it('failed — иконка ошибки в цвете ошибки, подсказка с кратким текстом ошибки', async () => {
    await render({
      status: 'failed',
      finishedAt: at(14, 30),
      errorMessage: '  timeout\n  of run ',
    });
    expect(icon().attributes('data-state')).toBe('failed');
    expect(icon().find('svg.animate-spin').exists()).toBe(false);
    expect(icon().find('svg').exists()).toBe(true);
    expect(icon().classes()).toContain('text-danger');
    expect(icon().attributes('aria-label')).toBe('ИИ-флоу упал в 14:30: timeout of run');
  });

  it('failed — длинный текст ошибки обрезается', async () => {
    await render({ status: 'failed', errorMessage: 'x'.repeat(500) });
    const label = icon().attributes('aria-label')!;
    expect(label.startsWith('ИИ-флоу упал: x')).toBe(true);
    expect(label.endsWith('…')).toBe(true);
    expect(label.length).toBeLessThan(150);
  });

  it('none — ничего не рендерит', async () => {
    await render({ status: 'none' });
    expect(icon().exists()).toBe(false);
    expect(w!.find('[data-testid="row"]').element.children).toHaveLength(0);
  });

  it('фокус с клавиатуры показывает подсказку с текстом состояния', async () => {
    await render({ status: 'failed', errorMessage: 'boom' });
    (icon().element as HTMLElement).focus();
    expect(document.activeElement).toBe(icon().element);
    await icon().trigger('focus');
    await flushPromises();
    const tip = [...document.body.querySelectorAll('[role="tooltip"]')].map((e) => e.textContent);
    expect(tip.join()).toContain('ИИ-флоу упал: boom');
  });

  it('клик ведёт на страницу запуска и не открывает задачу', async () => {
    let opened = 0;
    const { router } = await render({ status: 'running' }, () => opened++);
    expect(icon().attributes('href')).toBe('/runs/r1');
    await icon().trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/runs/r1');
    expect(opened).toBe(0);
  });

  it('внешняя ссылка на запуск — обычная ссылка в новой вкладке, клик не всплывает', async () => {
    let opened = 0;
    await render(
      { status: 'failed', runUrl: 'https://gitlab.example/pipelines/1' },
      () => opened++,
    );
    expect(icon().element.tagName).toBe('A');
    expect(icon().attributes('href')).toBe('https://gitlab.example/pipelines/1');
    expect(icon().attributes('target')).toBe('_blank');
    icon().element.addEventListener('click', (e) => e.preventDefault());
    await icon().trigger('click');
    expect(opened).toBe(0);
  });
});
