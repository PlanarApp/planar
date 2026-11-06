const layerOpen = () =>
  !!document.querySelector('[data-dismissable-layer]:not([data-state$="-open"])');

// a picker closes on its own Esc and Vue removes it in the microtask between listeners, before the
// window bubble phase — so the layer is checked at the start of the dispatch (PLNRAPP-101)
let held: Event | undefined;
if (typeof window !== 'undefined')
  window.addEventListener('keydown', (e) => (held = layerOpen() ? e : undefined), true);

/** an open popover, menu, select, dialog or sheet (a reka layer; tooltips don't count): Esc belongs to it */
export const overlayOpen = (e?: Event) => (!!e && e === held) || layerOpen();
