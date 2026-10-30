---
type: contract
status: "closed"
module: pwa
area: "web"
updated: "2026-10-30"
summary: "C-pwa v1: usePwa() — состояние обновлений SW и установки PWA для UI"
related: [docs/plan/pwa.md]
---

# Контракты модуля pwa

## C-pwa v1 — `usePwa()` (apps/web/src/pwa/usePwa.ts)
Владелец: PW-1. Потребители: `App.vue` (плашка), PW-2 (Профиль, диалог, палитра).

Один экземпляр состояния на приложение (модульные `ref`, регистрация SW — один раз при первом вызове).

```ts
type UpdateState = 'idle' | 'checking' | 'current' | 'available' | 'error';
export function usePwa(): {
  needRefresh: Readonly<Ref<boolean>>;      // новая версия ждёт применения (как сейчас в App.vue)
  updateState: Readonly<Ref<UpdateState>>;  // итог последней ручной проверки
  checkForUpdates(): Promise<UpdateState>;  // reg.update(); 'available' если после неё есть waiting/needRefresh, иначе 'current'; нет SW/ошибка → 'error'
  applyUpdate(): Promise<void>;             // updateServiceWorker(true)
  canInstall: Readonly<Ref<boolean>>;       // перехвачен beforeinstallprompt и не standalone
  isStandalone: Readonly<Ref<boolean>>;     // display-mode: standalone или navigator.standalone (iOS)
  isIos: boolean;                           // Safari iOS/iPadOS: установки через prompt нет, нужна инструкция
  install(): Promise<'accepted' | 'dismissed' | 'unavailable'>; // prompt() перехваченного события; после — canInstall=false
};
```

Инварианты:
- Автопроверка раз в 30 мин и при `visibilitychange → visible`, применение в скрытой вкладке — без изменений относительно текущего `App.vue`.
- `beforeinstallprompt`: `preventDefault()` и сохранение события; `appinstalled` → `canInstall=false`.
- Нет SW (dev без PWA, тесты) — `checkForUpdates()` даёт `'error'`, исключения наружу не летят.
