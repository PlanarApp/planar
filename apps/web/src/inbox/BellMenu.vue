<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Bell } from 'lucide-vue-next';
import { Button, EmptyState, IconButton, Popover } from '../ui';
import { mutate } from '../sync';
import { openTask } from '../views/open';
import { useUnreadItems, type InboxItem } from './queries';

// колокольчик: меню непрочитанных уведомлений; клик — прочитать и перейти
const { t, locale } = useI18n();
const router = useRouter();
const unread = useUnreadItems();
const open = ref(false);
const items = computed(() => (unread.value ?? []).slice(0, 50));
const time = (iso: string) =>
  new Date(iso).toLocaleString(locale.value, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const read = (ids: string[]) => ids.length && void mutate('notification.read', { ids });
function go(n: InboxItem) {
  open.value = false;
  read([n.id]);
  if (n.taskKey) openTask(n.taskKey);
  else if (n.url?.startsWith('/') && !/^\/[/\\]/.test(n.url)) void router.push(n.url);
}
function all() {
  open.value = false;
  void router.push('/w/work?w=activity');
}
</script>

<template>
  <Popover v-model:open="open" align="end">
    <template #trigger>
      <span class="relative">
        <IconButton :icon="Bell" :label="t('topbar.notifications')" data-testid="bell" />
        <span
          v-if="unread?.length"
          data-testid="bell-count"
          class="pointer-events-none absolute right-0 top-0 min-w-4 rounded-full bg-accent px-1 text-center text-2xs text-accent-fg"
          >{{ unread.length }}</span
        >
      </span>
    </template>
    <div class="flex w-80 flex-col gap-2" data-testid="bell-menu">
      <EmptyState v-if="!items.length" :title="t('inbox.empty')" />
      <div class="-mx-1 flex max-h-96 flex-col overflow-y-auto">
        <button
          v-for="n in items"
          :key="n.id"
          type="button"
          data-testid="bell-item"
          class="flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg-muted outline-none focus-visible:ring-2 ring-focus"
          @click="go(n)"
        >
          <span class="truncate font-medium">{{
            t(`inbox.kind.${n.kind}`, { who: n.actorName, key: n.taskKey ?? '?' })
          }}</span>
          <span v-if="n.taskTitle || n.comment || n.body" class="truncate text-xs text-fg-muted">{{
            n.comment || n.taskTitle || n.body
          }}</span>
          <span class="text-2xs text-fg-subtle">{{ time(n.createdAt) }}</span>
        </button>
      </div>
      <div class="flex items-center gap-2 border-t border-border pt-2">
        <Button
          v-if="items.length"
          size="sm"
          variant="ghost"
          data-testid="bell-read-all"
          @click="read((unread ?? []).map((n) => n.id))"
          >{{ t('inbox.readAll') }}</Button
        >
        <Button size="sm" variant="ghost" class="ml-auto" data-testid="bell-all" @click="all">{{
          t('topbar.allNotifications')
        }}</Button>
      </div>
    </div>
  </Popover>
</template>
