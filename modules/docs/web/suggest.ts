import type { Ref } from 'vue';

export interface SugItem {
  key: string;
  label: string;
}
export interface SugState {
  items: SugItem[];
  index: number;
  select: (i: number) => void;
  rect: DOMRect | null;
}

interface RenderProps {
  items: SugItem[];
  command: (item: never) => void;
  clientRect?: (() => DOMRect | null) | null;
}

/** render для @tiptap/suggestion: состояние пишем в ref, список рисует компонент. */
export const suggestRender = (state: Ref<SugState | null>) => () => {
  const set = (p: RenderProps) =>
    (state.value = {
      items: p.items,
      index: 0,
      select: (i) => p.items[i] && p.command(p.items[i] as never),
      rect: p.clientRect?.() ?? null,
    });
  return {
    onStart: set,
    onUpdate: set,
    onExit: () => (state.value = null),
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      const s = state.value;
      if (!s || !s.items.length) return false;
      if (event.key === 'ArrowDown') s.index = (s.index + 1) % s.items.length;
      else if (event.key === 'ArrowUp') s.index = (s.index + s.items.length - 1) % s.items.length;
      else if (event.key === 'Enter' || event.key === 'Tab') s.select(s.index);
      else return false;
      return true;
    },
  };
};
