// Public form page: plain TS, without Vue and router (≤ 30 KB gzip, C-http: /f/*)
interface Field {
  key: string;
  label: string;
  required: boolean;
  type: string;
  options?: { id: string; label: string }[];
}
interface Schema {
  title: string;
  description: string | null;
  fields: Field[];
}

export const MAX_FILES = 3;
const TEXT: Record<number, string> = {
  404: 'Форма не найдена или больше не принимает ответы.',
  413: 'Слишком большой объём данных. Уменьшите файлы или текст.',
  429: 'Слишком много отправок. Повторите позже.',
};
const failText = async (res: Response): Promise<string> => {
  if (res.status === 400) {
    const j = (await res.json().catch(() => ({}))) as { message?: string };
    return `Проверьте заполнение формы${j.message ? `: ${j.message}` : '.'}`;
  }
  return TEXT[res.status] ?? 'Не удалось отправить. Попробуйте ещё раз.';
};

function build(tag: string, props: Record<string, unknown>, kids: (Node | string)[]) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

function control(f: Field): HTMLElement {
  const base = { name: f.key, required: f.required };
  switch (f.type) {
    case 'longtext':
      return build('textarea', base, []);
    case 'select': {
      const s = build('select', base, [
        build('option', { value: '', textContent: '—' }, []),
        ...(f.options ?? []).map((o) => build('option', { value: o.id, textContent: o.label }, [])),
      ]);
      return s;
    }
    case 'files':
      return build('input', { ...base, type: 'file', multiple: true }, []);
    default: {
      const type =
        { email: 'email', number: 'number', money: 'number', date: 'date', url: 'url' }[f.type] ??
        'text';
      const i = build('input', { ...base, type }, []) as HTMLInputElement;
      if (f.type === 'money') i.step = '0.01';
      if (f.type === 'number') i.step = 'any';
      return i;
    }
  }
}

export async function mountForm(root: HTMLElement, slug: string): Promise<void> {
  const show = (...kids: Node[]) => root.replaceChildren(...kids);
  const msg = (t: string, cls = '') =>
    build('p', { textContent: t, className: cls, role: 'alert' }, []);
  // personal link "reply to a task": ?t=<token> goes to the API as is
  const t = new URLSearchParams(location.search).get('t');
  const q = t ? `?t=${encodeURIComponent(t)}` : '';
  let schema: Schema;
  try {
    const res = await fetch(`/api/forms/public/${encodeURIComponent(slug)}${q}`);
    if (!res.ok) return show(msg(await failText(res), 'err'));
    schema = (await res.json()) as Schema;
  } catch {
    return show(msg('Нет соединения. Попробуйте ещё раз.', 'err'));
  }
  document.title = schema.title;

  const form = build('form', { noValidate: true }, []) as HTMLFormElement;
  const errs = new Map<string, HTMLElement>();
  for (const f of schema.fields) {
    const c = control(f);
    const err = build('span', { className: 'err', role: 'alert' }, []);
    errs.set(f.key, err);
    form.append(build('label', {}, [f.label + (f.required ? ' *' : ''), c, err]));
  }
  // honeypot: empty, off-screen, not in tab order
  form.append(
    build('div', { className: 'hp' }, [
      build('label', {}, [
        'Website',
        build('input', { name: 'website', tabIndex: -1, autocomplete: 'off' }, []),
      ]),
    ]),
  );
  form.lastElementChild!.setAttribute('aria-hidden', 'true');
  const status = build('p', { className: 'err', role: 'alert' }, []);
  const btn = build(
    'button',
    { type: 'submit', textContent: 'Отправить' },
    [],
  ) as HTMLButtonElement;
  form.append(status, btn);

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void submit();
  });
  async function submit() {
    status.textContent = '';
    const values: Record<string, unknown> = {};
    const files: File[] = [];
    let bad = false;
    for (const f of schema.fields) {
      const c = form.elements.namedItem(f.key) as HTMLInputElement;
      let problem = '';
      if (f.type === 'files') {
        files.push(...Array.from(c.files ?? []));
        if (files.length > MAX_FILES) problem = `Не более ${MAX_FILES} файлов`;
        else if (f.required && !files.length) problem = 'Приложите файл';
      } else {
        const v = c.value.trim();
        const num = f.type === 'number' || f.type === 'money';
        const n = Number(v);
        if (v && num && !Number.isFinite(n)) problem = 'Введите число';
        // money — an integer in minimal units (kopecks), as in FieldEditor
        else if (v) values[f.key] = f.type === 'money' ? Math.round(n * 100) : num ? n : v;
        else if (f.required) problem = 'Обязательное поле';
      }
      errs.get(f.key)!.textContent = problem;
      bad ||= !!problem;
    }
    if (bad) return;
    const website = (form.elements.namedItem('website') as HTMLInputElement).value;
    const payload = { values, website };
    let init: RequestInit;
    if (files.length) {
      const fd = new FormData();
      fd.append('payload', JSON.stringify(payload));
      for (const x of files) fd.append('file', x);
      init = { method: 'POST', body: fd };
    } else
      init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      };
    btn.disabled = true;
    try {
      const res = await fetch(`/api/forms/public/${encodeURIComponent(slug)}${q}`, init);
      if (!res.ok) status.textContent = await failText(res);
      else
        show(
          build('h1', { textContent: 'Отправлено' }, []),
          msg('Спасибо, мы получили ваш ответ.', 'ok'),
        );
    } catch {
      status.textContent = 'Нет соединения. Попробуйте ещё раз.';
    }
    btn.disabled = false;
  }

  show(
    build('h1', { textContent: schema.title }, []),
    ...(schema.description
      ? [build('p', { className: 'desc', textContent: schema.description }, [])]
      : []),
    form,
  );
}
