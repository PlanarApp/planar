<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ArrowRight, Bell, Check } from 'lucide-vue-next';
import { Button, EmptyState, IconButton, Popover } from '../ui';
import { mutate } from '../sync';
import { openTask } from '../views/open';
import { useUnreadItems, type InboxItem } from './queries';

// bell: menu of unread notifications; click — read it and go to it
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
        <div
          v-for="n in items"
          :key="n.id"
          class="flex items-start gap-1 rounded-md hover:bg-bg-muted"
        >
          <button
            type="button"
            data-testid="bell-item"
            class="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 ring-focus"
            @click="go(n)"
          >
            <span class="flex flex-wrap items-center gap-1 break-words font-medium">
              {{ t(`inbox.kind.${n.kind}`, { who: n.actorName, key: n.taskKey ?? '?' }) }}
              <template v-if="n.status">
                <span v-for="(s, i) in n.status" :key="i" class="contents">
                  <ArrowRight v-if="i" :size="12" aria-hidden="true" />
                  <span
                    class="rounded px-1.5 py-0.5 text-xs text-fg"
                    data-testid="bell-status"
                    :style="{ background: `color-mix(in srgb, ${s.color} 16%, transparent)` }"
                    >{{ s.name }}</span
                  >
                </span>
              </template>
            </span>
            <span
              v-if="n.taskTitle || n.comment || n.body"
              class="line-clamp-3 break-words text-xs text-fg-muted"
              >{{ n.comment || n.taskTitle || n.body }}</span
            >
            <span class="text-2xs text-fg-subtle">{{ time(n.createdAt) }}</span>
          </button>
          <IconButton
            :icon="Check"
            :label="t('inbox.read')"
            size="sm"
            class="mt-1 shrink-0"
            data-testid="bell-read"
            @click="read([n.id])"
          />
        </div>
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
