---
type: contract
status: "closed"
module: pwa
area: "web"
updated: "2026-10-30"
summary: "C-pwa v1: usePwa() — service worker update and PWA install state for the UI"
related: [docs/plan/pwa.md]
---

# Contracts of the pwa module

## C-pwa v1 — `usePwa()` (apps/web/src/pwa/usePwa.ts)
Owner: PW-1. Consumers: `App.vue` (banner), PW-2 (Profile, dialog, palette).

One state instance per application (module-level `ref`s; the SW is registered once, on the first call).

```ts
type UpdateState = 'idle' | 'checking' | 'current' | 'available' | 'error';
export function usePwa(): {
  needRefresh: Readonly<Ref<boolean>>;      // a new version is waiting to be applied (as in App.vue now)
  updateState: Readonly<Ref<UpdateState>>;  // result of the last manual check
  checkForUpdates(): Promise<UpdateState>;  // reg.update(); 'available' if waiting/needRefresh is set after it, otherwise 'current'; no SW/error → 'error'
  applyUpdate(): Promise<void>;             // updateServiceWorker(true)
  canInstall: Readonly<Ref<boolean>>;       // beforeinstallprompt was intercepted and not standalone
  isStandalone: Readonly<Ref<boolean>>;     // display-mode: standalone or navigator.standalone (iOS)
  isIos: boolean;                           // Safari iOS/iPadOS: no install via prompt, instructions are needed
  install(): Promise<'accepted' | 'dismissed' | 'unavailable'>; // prompt() of the intercepted event; afterwards canInstall=false
};
```

Invariants:
- Automatic check every 30 min and on `visibilitychange → visible`; applying the update in a hidden tab — unchanged relative to the current `App.vue`.
- `beforeinstallprompt`: `preventDefault()` and store the event; `appinstalled` → `canInstall=false`.
- No SW (dev without PWA, tests) — `checkForUpdates()` returns `'error'`; no exceptions propagate.
