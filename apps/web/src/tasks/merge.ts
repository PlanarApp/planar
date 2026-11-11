import { shallowRef } from 'vue';
import { mutate, newId } from '../sync';

/** The task being merged into another one (PLNRAPP-117): MergeDialog asks for the target. */
export const mergeFrom = shallowRef<{
  id: string;
  key: string;
  title: string;
  spaceId: string;
} | null>(null);

export const mergeTask = (id: string, targetId: string): Promise<void> =>
  mutate('task.merge', { id, targetId, linkId: newId() });
