<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getConsent, setConsent } from './analytics';

const show = ref(false);
const ru = ref(false);
onMounted(() => {
  ru.value = location.pathname.startsWith('/ru');
  show.value = getConsent() === null;
});
function choose(v: 'granted' | 'denied') {
  setConsent(v);
  show.value = false;
}
</script>

<template>
  <div v-if="show" class="consent" role="dialog" aria-label="cookies">
    <span>{{
      ru
        ? 'Сайт использует аналитические cookies (Google Analytics, Яндекс Метрика) только с вашего согласия.'
        : 'This site uses analytics cookies (Google Analytics, Yandex Metrika) only with your consent.'
    }}</span>
    <button @click="choose('granted')">{{ ru ? 'Принять' : 'Accept' }}</button>
    <button @click="choose('denied')">{{ ru ? 'Отклонить' : 'Decline' }}</button>
  </div>
</template>

<style scoped>
.consent {
  position: fixed;
  z-index: 100;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  padding: 10px 16px;
  background: var(--vp-c-bg-soft);
  border-top: 1px solid var(--vp-c-divider);
  font-size: 13px;
}
.consent button {
  padding: 2px 12px;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 4px;
}
</style>
