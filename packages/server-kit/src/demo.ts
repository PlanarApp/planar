let demo = false;
/** Set by createApp(opts.demo); the env is read only in apps/api main.ts (parseDemoMode). */
export const setDemo = (on: boolean): void => {
  demo = on;
};
/** demo: outgoing email/push/webhooks/polling are no-ops. shortcut: process-wide, the last createApp wins; per-module DI if apps with different modes ever share a process. */
export const isDemo = (): boolean => demo;
