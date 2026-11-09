// PJ-11 contract test: every entity that refers to a project (directly, through a task, comment, channel, ...)
// is covered by the visibility rule; a new entity cannot be forgotten.
import { describe, expect, it } from 'vitest';
import {
  PROJECT_REFS,
  SELF_REFS,
  projectIdSql,
  projectRefOf,
} from '../../src/sync/project-access.js';
import { allMetas, schemaOf } from '../../src/sync/rows.js';

/** Keys that look like a reference to a project's row but intentionally do not decide the project. */
const NOT_A_REF = new Set([
  'parentId', // same project or space-level by construction
  'targetId', // taskLinks: the link belongs to the project of taskId
  'linkedTaskId', // checklistItems: the item belongs to the project of taskId (PLNRAPP-142)
  'cycleId',
  'statusId',
  'labelId',
  'messageId',
  'dashboardId',
  'goalId',
]);
const LOOKS_LIKE_REF = /(project|task|comment|channel|milestone|page|rule)Id$/i;
const covered = new Set(PROJECT_REFS.map(([c]) => c));

describe('pj11: покрытие сущностей правилом видимости проекта', () => {
  const entities = Object.keys(allMetas());

  it('pj11 есть что проверять: ядро и модули', () => {
    expect(entities).toEqual(
      expect.arrayContaining(['tasks', 'comments', 'chatChannels', 'timeEntries']),
    );
  });

  for (const e of entities) {
    it(`pj11 ${e}: ссылка на проект/задачу покрыта`, () => {
      const keys = Object.keys(schemaOf(e).shape);
      const refs = keys.filter((k) => covered.has(k));
      const unknown = keys.filter(
        (k) =>
          LOOKS_LIKE_REF.test(k) && !covered.has(k) && !NOT_A_REF.has(k) && k !== 'gitlabProjectId',
      );
      expect(
        unknown,
        `${e}: ссылка на сущность проекта без правила — добавьте её в PROJECT_REFS`,
      ).toEqual([]);
      if (refs.length || e in SELF_REFS) {
        expect(projectRefOf(e), e).not.toBeNull();
        expect(projectIdSql(e), e).not.toBeNull();
      } else {
        expect(projectRefOf(e), `${e} не ссылается на проект`).toBeNull();
      }
    });
  }

  it('pj11 PROJECT_REFS: цель каждой ссылки — сущность со своей ссылкой на проект', () => {
    for (const [, target] of PROJECT_REFS)
      if (target) expect(projectRefOf(target), target).not.toBeNull();
    for (const target of Object.values(SELF_REFS))
      if (target) expect(projectRefOf(target)).not.toBeNull();
  });
});
