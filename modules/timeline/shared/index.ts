import type { SharedModuleManifest } from '@planar/shared';

/** A module with no entities or mutators of its own: the core mutator task.update edits its dates (P3-timeline v1). */
export const shared: SharedModuleManifest = { id: 'timeline', mutators: [], entities: {} };
