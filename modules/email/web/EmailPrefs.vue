<script setup lang="ts">
import { useSession } from '@planar/web/modules';
import { mutate, tr, usePrefs } from './data';

const me = useSession();
const prefs = usePrefs(() => me.value?.id);
const set = (k: 'notify' | 'digest', v: boolean) =>
  me.value && mutate('email.setPrefs', { id: me.value.id, [k]: v });
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="email-prefs">
    <h2 class="text-lg font-semibold">{{ tr('prefs') }}</h2>
    <label class="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        data-testid="email-notify"
        :checked="prefs?.notify ?? true"
        @change="set('notify', ($event.target as HTMLInputElement).checked)"
      />
      {{ tr('notify') }}
    </label>
    <label class="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        data-testid="email-digest"
        :checked="prefs?.digest ?? false"
        @change="set('digest', ($event.target as HTMLInputElement).checked)"
      />
      {{ tr('digest') }}
    </label>
  </section>
</template>
