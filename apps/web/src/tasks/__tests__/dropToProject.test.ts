// PLNRAPP-152: a task dropped onto a sidebar project moves there
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ops', () => ({ updateTask: vi.fn(async () => {}) }));

import { updateTask } from '../ops';
import { dragged, endTaskDrag, overProject, startTaskDrag } from '../dropToProject';

const update = updateTask as unknown as ReturnType<typeof vi.fn>;

describe('PLNRAPP-152 перенос задачи на проект сайдбара', () => {
  beforeEach(() => update.mockClear());

  it('над проектом: переносит и сообщает, что сброс забран; свой проект — без мутации', () => {
    startTaskDrag({ id: 't', projectId: 'a' });
    overProject.value = 'b';
    expect(endTaskDrag()).toBe(true);
    expect(update).toHaveBeenCalledWith('t', { projectId: 'b' });
    expect([dragged.value, overProject.value]).toEqual([null, null]);

    startTaskDrag({ id: 't', projectId: 'a' });
    expect(endTaskDrag('a')).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('не над проектом или без перетаскивания — обычный сброс', () => {
    startTaskDrag({ id: 't', projectId: 'a' });
    expect(endTaskDrag()).toBe(false);
    expect(endTaskDrag('b')).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
