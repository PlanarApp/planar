/**
 * The app fits the visible viewport, so the phone keyboard shrinks the layout instead of pushing the
 * page up (PLNRAPP-122): the chat composer stays above the keyboard, the header stays on screen.
 * Android follows `interactive-widget=resizes-content` in index.html; iOS ignores it — there the height
 * comes from visualViewport and the pan the browser adds when focusing an input is reset.
 */
export function fitVisualViewport(win: Window = window): void {
  const vv = win.visualViewport;
  if (!vv) return;
  const root = win.document.documentElement;
  const fit = () => {
    root.style.setProperty('--app-h', `${vv.height}px`);
    if (win.scrollY) win.scrollTo(0, 0);
  };
  vv.addEventListener('resize', fit);
  fit();
}
