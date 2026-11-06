/** an open popover, menu, select, dialog or sheet (a reka layer; tooltips don't count): Esc belongs to it */
export const overlayOpen = () =>
  !!document.querySelector('[data-dismissable-layer]:not([data-state$="-open"])');
