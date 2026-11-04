import type { MutatorDef } from '../contract/index.js';
import { checklistMutators } from './checklist.js';
import { commentMutators } from './comments.js';
import { fieldMutators } from './fields.js';
import { labelMutators } from './labels.js';
import { linkMutators } from './links.js';
import { memberMutators } from './members.js';
import { miscMutators } from './misc.js';
import { projectMutators } from './projects.js';
import { spaceMutators } from './spaces.js';
import { statusMutators } from './statuses.js';
import { taskMutators } from './tasks.js';
import { dayMutators } from './day.js';

export { extractMentions, textToDoc } from './text.js';

export const domainMutators = [
  ...spaceMutators,
  ...memberMutators,
  ...projectMutators,
  ...statusMutators,
  ...labelMutators,
  ...taskMutators,
  ...fieldMutators,
  ...linkMutators,
  ...checklistMutators,
  ...commentMutators,
  ...miscMutators,
  ...dayMutators,
] as MutatorDef[];
