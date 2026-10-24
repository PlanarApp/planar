import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@planar/shared';
import type { PlanarDB } from '../../../sync/db';
import { mountForm } from '../../../form/form';
import { genSlug } from '../../../../../../modules/forms/web/slug';
import Settings from '../../../../../../modules/forms/web/FormsSettings.vue';
import { SLUG_RE } from '../../../../../../modules/forms/shared/index';

const mutate = vi.hoisted(() => vi.fn(async () => {}));
const h = vi.hoisted(() => ({ db: undefined as unknown as PlanarDB }));
vi.mock('../../../sync', async () => {
  const { PlanarDB } = await import('../../../sync/db');
  const { useQuery } = await import('../../../sync/query');
  h.db = new PlanarDB('pt5b', { formsForms: ['spaceId', 'projectId'] });
  return { db: h.db, mutate, registerMutators: vi.fn(), useQuery, newId: () => 'new-id' };
});
vi.mock('../../../auth/useAuth', () => ({
  useAuth: () => ({ user: ref({ id: 'u', role: 'admin' }) }),
}));

const schema = {
  title: 'Заявка',
  description: 'Опишите проблему',
  fields: [
    { key: 'title', label: 'Тема', required: true, type: 'text' },
    { key: 'description', label: 'Текст', required: false, type: 'longtext' },
    { key: 'email', label: 'Почта', required: false, type: 'email' },
    {
      key: 'field:x',
      label: 'Приоритет',
      required: false,
      type: 'select',
      options: [{ id: 'a', label: 'Высокий' }],
    },
    { key: 'files', label: 'Файлы', required: false, type: 'files' },
  ],
};
const res = (status: number, body: unknown = {}) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

let root: HTMLElement;
let calls: { path: string; init?: RequestInit }[];
let post: Response;
beforeEach(() => {
  calls = [];
  post = res(201, { ok: true });
  document.body.innerHTML = '<main id="f"></main>';
  root = document.getElementById('f')!;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      return init?.method === 'POST' ? post : res(200, schema);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const open = async () => {
  await mountForm(root, 'abcdefghij012345');
  return root.querySelector('form')!;
};
const submit = async (f: HTMLFormElement) => {
  f.dispatchEvent(new Event('submit', { cancelable: true }));
  await flushPromises();
};
const type = (f: HTMLFormElement, name: string, v: string) =>
  void ((f.elements.namedItem(name) as HTMLInputElement).value = v);

describe('pt5b:', () => {
  it('pt5b: поля рисуются по схеме', async () => {
    const f = await open();
    expect(root.querySelector('h1')!.textContent).toBe('Заявка');
    expect(f.querySelector('textarea[name=description]')).toBeTruthy();
    expect(f.querySelector('input[name=email][type=email]')).toBeTruthy();
    expect(f.querySelectorAll('select[name="field:x"] option')).toHaveLength(2);
    expect(f.querySelector('input[type=file]')).toBeTruthy();
  });

  it('pt5b: обязательное поле блокирует отправку', async () => {
    const f = await open();
    await submit(f);
    expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(0);
    expect(f.textContent).toContain('Обязательное поле');
  });

  it('pt5b: honeypot вне экрана, без табуляции и пуст', async () => {
    const f = await open();
    const hp = f.querySelector('input[name=website]') as HTMLInputElement;
    expect(hp.value).toBe('');
    expect(hp.tabIndex).toBe(-1);
    expect(hp.autocomplete).toBe('off');
    expect(hp.closest('.hp')!.getAttribute('aria-hidden')).toBe('true');
    type(f, 'title', 'Сбой');
    await submit(f);
    const body = JSON.parse(calls.at(-1)!.init!.body as string);
    expect(body).toEqual({ values: { title: 'Сбой' }, website: '' });
    expect(root.textContent).toContain('Отправлено');
  });

  it.each([
    [429, 'Слишком много отправок'],
    [404, 'не найдена'],
    [400, 'Проверьте заполнение'],
  ])('pt5b: ответ %i показывается текстом', async (code, text) => {
    const f = await open();
    type(f, 'title', 'x');
    post = res(code, { message: 'плохо' });
    await submit(f);
    expect(f.textContent).toContain(text);
    expect(root.textContent).not.toContain('Отправлено');
  });

  it('pt5b: 404 на схеме — понятный экран', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res(404)),
    );
    await mountForm(root, 'nope');
    expect(root.textContent).toContain('не найдена');
  });

  it('pt5b: файлы уходят multipart: payload + file', async () => {
    const f = await open();
    type(f, 'title', 'Сбой');
    const input = f.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')],
    });
    await submit(f);
    const fd = calls.at(-1)!.init!.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect(JSON.parse(fd.get('payload') as string).values).toEqual({ title: 'Сбой' });
    expect(fd.getAll('file')).toHaveLength(2);
  });

  it('pt5b: slug — 16 символов [a-z0-9], разные', () => {
    const a = genSlug();
    expect(a).toMatch(SLUG_RE);
    expect(genSlug()).not.toBe(a);
  });

  it('pt5b: конструктор шлёт forms.create с slug и title-полем', async () => {
    const sp = uuidv7();
    const pr = uuidv7();
    const st = uuidv7();
    await h.db
      .table('projects')
      .put({ id: pr, spaceId: sp, name: 'P', archivedAt: null, rank: 'a' });
    await h.db.table('statuses').put({ id: st, spaceId: sp, name: 'Todo', rank: 'a' });
    const w = mount(Settings);
    await vi.waitFor(() => expect(w.findAll('[data-testid=fm-status] option')).toHaveLength(1));
    await w.get('[data-testid=fm-title]').setValue('Обратная связь');
    await w.get('form').trigger('submit');
    await flushPromises();
    const [name, args] = mutate.mock.calls.at(-1) as unknown as [string, Record<string, unknown>];
    expect(name).toBe('forms.create');
    expect(args).toMatchObject({
      projectId: pr,
      statusId: st,
      title: 'Обратная связь',
      fields: [{ key: 'title', required: true }],
    });
    expect(args.slug).toMatch(SLUG_RE);
  });
});
