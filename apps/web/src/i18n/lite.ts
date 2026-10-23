// Облегчённая замена vue-i18n для сборки (alias в vite.config.ts): только то, чем пользуется приложение —
// createI18n({legacy:false}), useI18n() → {t, te, locale}, i18n.global.{t,locale}, подстановки {name} и {'литерал'}.
// shortcut: нет plural/linked/datetime/number; понадобятся — убрать alias и вернуть vue-i18n.
import { inject, ref, type App, type Ref } from 'vue';

type Tree = { [k: string]: string | Tree };
type Params = Record<string, unknown>;
interface Opts {
  locale: string;
  fallbackLocale?: string;
  messages: Record<string, Tree>;
}

const KEY = Symbol('i18n');

const find = (tree: Tree | undefined, key: string): string | undefined => {
  let n: string | Tree | undefined = tree;
  for (const p of key.split('.')) n = typeof n === 'object' ? n[p] : undefined;
  return typeof n === 'string' ? n : undefined;
};

export function createI18n(o: Opts) {
  const locale: Ref<string> = ref(o.locale);
  const get = (key: string) =>
    find(o.messages[locale.value], key) ??
    (o.fallbackLocale ? find(o.messages[o.fallbackLocale], key) : undefined);
  const t = (key: string, p?: Params): string =>
    (get(key) ?? key).replace(/\{(?:'([^']*)'|(\w+))\}/g, (_, lit, name) =>
      lit !== undefined ? lit : String(p?.[name] ?? ''),
    );
  const te = (key: string): boolean => find(o.messages[locale.value], key) !== undefined;
  const global = { locale, t, te };
  return { global, install: (app: App) => void app.provide(KEY, global) };
}

export const useI18n = () => inject(KEY) as ReturnType<typeof createI18n>['global'];
