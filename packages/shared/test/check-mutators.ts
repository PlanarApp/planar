// Проверка CR-5: реестр domainMutators = таблица «Мутаторы домена v1» (имена, аргументы, необязательность).
// Запуск: pnpm exec tsx packages/shared/test/check-mutators.ts → «mutators-ok» или список расхождений.
// Правит только координатор модуля core.
import * as shared from '../src/index.js';
import { docMutators } from './contract-doc.js';

type Shape = Record<string, { safeParse(v: unknown): { success: boolean } }>;
const defs = (shared as unknown as { domainMutators?: { name: string; args: { shape?: Shape } }[] })
  .domainMutators;
const errs: string[] = [];
if (!defs) errs.push('нет экспорта domainMutators');
const byName = new Map((defs ?? []).map((d) => [d.name, d]));
for (const m of docMutators) {
  const d = byName.get(m.name);
  if (!d) {
    errs.push(`нет мутатора ${m.name}`);
    continue;
  }
  const shape = d.args.shape;
  if (!shape) {
    errs.push(`${m.name}: args не z.object`);
    continue;
  }
  const want = m.args.map((a) => a.name).sort();
  const got = Object.keys(shape).sort();
  if (want.join() !== got.join()) errs.push(`${m.name}: args ${got.join(',')} ≠ ${want.join(',')}`);
  for (const a of m.args) {
    if (shape[a.name] && shape[a.name].safeParse(undefined).success !== a.optional)
      errs.push(`${m.name}.${a.name}: optional должен быть ${a.optional}`);
  }
}
for (const n of byName.keys())
  if (!docMutators.some((m) => m.name === n)) errs.push(`лишний мутатор ${n}`);
if (docMutators.length === 0) errs.push('таблица мутаторов не разобрана');
console.log(errs.length ? errs.join('\n') : `mutators-ok ${docMutators.length}`);
process.exitCode = errs.length ? 1 : 0;
