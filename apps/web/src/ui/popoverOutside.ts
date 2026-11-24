/** the pointer is within the element box (PLNRAPP-820: a press inside a popover is not «outside») */
export function insideBox(e: { clientX: number; clientY: number }, box: Element): boolean {
  const r = box.getBoundingClientRect();
  const { clientX: x, clientY: y } = e;
  return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
