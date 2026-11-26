// Sidebar lists are reordered by drag (PLNRAPP-72, -89); on touch a swipe must scroll the list,
// so the drag starts only after a long press (PLNRAPP-880). The mouse drags at once, as before.
export const SIDEBAR_DRAG = {
  animation: 150,
  // long press: 250 ms; a finger that moves more than 5 px earlier scrolls instead
  delay: 250,
  delayOnTouchOnly: true,
  touchStartThreshold: 5,
} as const;

// a long press must not open the system link preview / text selection (iOS, PWA); select-none only
// on links: on an ancestor iOS Safari breaks typing in the rename inputs of these lists
export const NO_CALLOUT = '[-webkit-touch-callout:none] [&_a]:select-none';
