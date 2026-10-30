import { onBeforeUnmount, ref } from 'vue';
import { onTyping } from '@planar/web/modules';

const TTL = 5000;

/** ‘Typing…’ in the channel: userId → fades 5 s after the last event. */
export function useTyping(channelId: string, me: () => string) {
  const who = ref<string[]>([]);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const off = onTyping((e) => {
    if (e.entity !== 'chatChannels' || e.id !== channelId || e.userId === me()) return;
    clearTimeout(timers.get(e.userId));
    if (!who.value.includes(e.userId)) who.value = [...who.value, e.userId];
    timers.set(
      e.userId,
      setTimeout(() => {
        timers.delete(e.userId);
        who.value = who.value.filter((u) => u !== e.userId);
      }, TTL),
    );
  });
  onBeforeUnmount(() => {
    off();
    timers.forEach(clearTimeout);
  });
  return who;
}
