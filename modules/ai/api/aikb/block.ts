// core.js, not index.js: index pulls sections/runs.ts, which imports run.ts — a cycle with run.ts (resultSchema is not yet defined).
import { core } from './core.js';

/** The common knowledge block appended to the prompt of every AI run (aikb-section v1); the section ids are left to the ai_kb tool. */
export const kbBlock = () =>
  '\n\n# Planar knowledge\n' + core(process.env.PUBLIC_URL ?? 'http://localhost:5173');
