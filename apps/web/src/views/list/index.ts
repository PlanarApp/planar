/** PLNRAPP-863: the reusable task list — for the project List and other screens */
export { default as TaskListView } from './TaskListView.vue';
export type { TaskListSource } from './source';
export {
  useViewSettings,
  type ViewDensity,
  type ViewSettingsCtx,
  type ViewSettingsSource,
} from './viewSettings';
