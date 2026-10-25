import { inject, provide, type InjectionKey } from 'vue';
import type { RouteLocationRaw } from 'vue-router';

/** Адреса канала и треда: страница /m/chat или таб «Чаты» группы (?c=…&t=…). */
export interface ChatLinks {
  channel(id: string): RouteLocationRaw;
  thread(channelId: string, rootId: string): RouteLocationRaw;
}
const KEY: InjectionKey<ChatLinks> = Symbol('chatLinks');
const PAGE: ChatLinks = {
  channel: (id) => `/m/chat/c/${id}`,
  thread: (c, r) => `/m/chat/c/${c}/t/${r}`,
};
export const provideChatLinks = (l: ChatLinks) => provide(KEY, l);
export const useChatLinks = (): ChatLinks => inject(KEY, PAGE);
