import { ref, watch } from 'vue';

const KEY = 'planar.snooze';
const load = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
};
// shortcut: "snooze" is stored on the device, not synced between devices; needs an entity in C-schema
export const snoozed = ref<Record<string, string>>(load());

// "now" for reactivity: ticks at the nearest expiry so snoozed items return on time
const tick = ref(Date.now());
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  [snoozed, tick],
  () => {
    clearTimeout(timer);
    const now = Date.now();
    const next = Math.min(
      ...Object.values(snoozed.value)
        .map((u) => Date.parse(u))
        .filter((t) => t > now),
    );
    // setTimeout holds at most 2^31 ms; beyond that the tick just fires early and reschedules
    if (next < Infinity)
      timer = setTimeout(() => (tick.value = Date.now()), Math.min(next - now, 2 ** 31 - 1) + 1);
  },
  { immediate: true, flush: 'sync' },
);

export function snooze(id: string, until: Date): void {
  snoozed.value = { ...snoozed.value, [id]: until.toISOString() };
  try {
    localStorage.setItem(KEY, JSON.stringify(snoozed.value));
  } catch {
    /* storage unavailable: postponed until reload */
  }
}

/** Whether the notification is hidden at moment now (reads reactive snoozed). */
export const isSnoozed = (id: string, now = new Date()): boolean => {
  void tick.value;
  const u = snoozed.value[id];
  return !!u && new Date(u) > now;
};

export type SnoozeOption = '3h' | 'tomorrow' | 'week';
export function snoozeUntil(o: SnoozeOption, now = new Date()): Date {
  const d = new Date(now);
  if (o === '3h') d.setHours(d.getHours() + 3);
  else if (o === 'week') d.setDate(d.getDate() + 7);
  else {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  }
  return d;
}
