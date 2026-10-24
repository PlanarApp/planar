import type { SharedModuleManifest } from '@planar/shared';

/** Модуль без своих сущностей и мутаторов: даты правит core-мутатор task.update (P3-timeline v1). */
export const shared: SharedModuleManifest = { id: 'timeline', mutators: [], entities: {} };
