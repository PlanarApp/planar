import { mount } from '@vue/test-utils';
import { defineComponent, h, ref, vModelText, withDirectives } from 'vue';
import { afterEach, expect, it } from 'vitest';
import { commitImeOnEnter } from './imeEnter';

const stop = commitImeOnEnter(document);
afterEach(() => (document.body.innerHTML = ''));

// a mobile keyboard keeps the last word in composition: v-model skips it until compositionend
it('Enter while composing sees the word still being typed', () => {
  const seen: string[] = [];
  const title = ref('');
  const w = mount(
    defineComponent({
      render: () =>
        withDirectives(
          h('input', {
            'onUpdate:modelValue': (v: string) => (title.value = v),
            onKeydown: (e: KeyboardEvent) => e.key === 'Enter' && seen.push(title.value),
          }),
          [[vModelText, title.value]],
        ),
    }),
    { attachTo: document.body },
  );
  const el = w.find('input').element;
  el.value = 'перенос по';
  el.dispatchEvent(new Event('input'));
  el.dispatchEvent(new CompositionEvent('compositionstart'));
  el.value = 'перенос по словам';
  el.dispatchEvent(new Event('input'));
  expect(title.value).toBe('перенос по'); // the bug: v-model waits for compositionend
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(seen).toEqual(['перенос по словам']);
  el.dispatchEvent(new CompositionEvent('compositionend'));
  expect(title.value).toBe('перенос по словам');
  w.unmount();
});

it('stops listening', () => {
  stop();
  const el = document.body.appendChild(document.createElement('input'));
  let inputs = 0;
  el.addEventListener('input', () => inputs++);
  (el as HTMLInputElement & { composing?: boolean }).composing = true;
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(inputs).toBe(0);
});
