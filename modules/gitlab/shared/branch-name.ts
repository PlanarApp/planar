// PLNRAPP-153: the branch name template of a project, transliteration of a task title, git ref check.
// Shared: the server validates and renders, the web checks the edited name in the dialog.

export const DEFAULT_BRANCH_TEMPLATE = '{TASK_KEY}';
export const BRANCH_PLACEHOLDERS = ['TASK_KEY', 'TASK_NAME', 'USER_LOGIN'] as const;
export const BRANCH_NAME_MAX = 200;
const TASK_NAME_MAX = 50;

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}; // prettier-ignore

/** `{TASK_NAME}`: lower case, Cyrillic → Latin, other characters → `-`, no repeats, ≤ 50 characters. */
export function translit(title: string): string {
  const lat = [...title.toLowerCase()].map((c) => CYR[c] ?? c).join('');
  return lat
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, TASK_NAME_MAX)
    .replace(/-+$/, '');
}

/** Why the name is not a valid git branch (ref); null — valid. */
export function gitRefError(name: string): string | null {
  if (!name) return 'Имя ветки пустое';
  if (name.length > BRANCH_NAME_MAX) return `Имя ветки длиннее ${BRANCH_NAME_MAX} символов`;
  if (/[\s\x00-\x1f\x7f]/.test(name)) return 'В имени ветки не должно быть пробелов';
  if (name.includes('..')) return 'В имени ветки не должно быть «..»';
  const bad = name.match(/[~^:?*[\\]/);
  if (bad) return `В имени ветки недопустим символ «${bad[0]}»`;
  if (/^[/.]|[/.]$/.test(name)) return 'Имя ветки не начинается и не заканчивается на «/» или «.»';
  if (name.endsWith('.lock')) return 'Имя ветки не заканчивается на «.lock»';
  return null;
}

export interface BranchVars {
  key: string;
  title: string;
  login: string;
}

/** The template with its placeholders filled in (the template is assumed valid). */
export function renderBranch(template: string, v: BranchVars): string {
  const val: Record<string, string> = {
    TASK_KEY: v.key,
    TASK_NAME: translit(v.title),
    USER_LOGIN: v.login,
  };
  return template.replace(/\{([^{}]*)\}/g, (m, n: string) => val[n] ?? m);
}

const SAMPLE: BranchVars = { key: 'ABC-12', title: 'Пример задачи', login: 'user' };

/** Why the template is invalid; null — valid: known placeholders, balanced braces, the result on sample data is a git ref. */
export function branchTemplateError(template: string): string | null {
  let open = -1;
  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    if (c === '{') {
      if (open >= 0) return 'Незакрытая «{» в шаблоне';
      open = i;
    } else if (c === '}') {
      if (open < 0) return 'Лишняя «}» в шаблоне';
      const name = template.slice(open + 1, i);
      if (!(BRANCH_PLACEHOLDERS as readonly string[]).includes(name))
        return `Неизвестное поле {${name}}; доступны ${BRANCH_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}`;
      open = -1;
    }
  }
  if (open >= 0) return 'Незакрытая «{» в шаблоне';
  const err = gitRefError(renderBranch(template, SAMPLE));
  return err && `Шаблон даёт недопустимое имя: ${err[0]!.toLowerCase()}${err.slice(1)}`;
}
