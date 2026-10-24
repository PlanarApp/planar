<script setup lang="ts">
import { ref } from 'vue';
import { Inbox, MoreHorizontal, Plus, Search, Settings, Trash2 } from 'lucide-vue-next';
import {
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Chip,
  ConfirmDialog,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  Kbd,
  Menu,
  Popover,
  Select,
  Tabs,
  Toolbar,
  Tooltip,
  useTheme,
  type MenuItem,
} from '../ui';

// витрина только для dev: литералы без i18n
const { theme } = useTheme();
const text = ref('');
const sel = ref<string | null>('todo');
const tab = ref('a');
const dlg = ref(false);
const cfm = ref(false);
const pop = ref(false);
const pressed = ref(false);
const opts = [
  { value: 'todo', label: 'Todo', color: '#ca8a04' },
  { value: 'done', label: 'Done', color: '#15803d' },
];
const people = [
  { name: 'Анна Белова' },
  { name: 'Борис Орлов' },
  { name: 'Вера Глухова' },
  { name: 'Глеб Зуев' },
];
const items: MenuItem[] = [
  { id: 'a', label: 'Открыть', icon: Inbox, shortcut: 'Mod+O', onSelect: () => {} },
  { separator: true },
  {
    id: 'd',
    label: 'Удалить',
    icon: Trash2,
    danger: true,
    confirm: {
      title: 'Удалить?',
      description: 'Это действие необратимо.',
      confirmLabel: 'Удалить',
    },
    onSelect: () => {},
  },
];
// классы литералами: Tailwind выбрасывает неиспользуемые токены
const neutrals = [
  'bg-neutral-1',
  'bg-neutral-2',
  'bg-neutral-3',
  'bg-neutral-4',
  'bg-neutral-5',
  'bg-neutral-6',
  'bg-neutral-7',
  'bg-neutral-8',
  'bg-neutral-9',
  'bg-neutral-10',
];
const variants = ['primary', 'secondary', 'ghost', 'danger-ghost', 'danger'] as const;
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-6 p-4 text-fg">
    <h1 class="text-xl font-semibold">C-ui v3</h1>
    <Tabs
      v-model="theme"
      label="Тема"
      :items="[
        { value: 'system', label: 'Система' },
        { value: 'light', label: 'Светлая' },
        { value: 'dark', label: 'Тёмная' },
      ]"
    />

    <section class="flex flex-col gap-2">
      <h2 class="text-lg font-semibold">Button</h2>
      <div
        v-for="size in ['md', 'sm'] as const"
        :key="size"
        class="flex flex-wrap items-center gap-2"
      >
        <Button v-for="v in variants" :key="v" :variant="v" :size="size" :icon="Plus">{{
          v
        }}</Button>
        <Button :size="size" loading>loading</Button>
        <Button :size="size" disabled>disabled</Button>
      </div>
    </section>

    <section class="flex flex-col gap-2">
      <h2 class="text-lg font-semibold">IconButton</h2>
      <div class="flex items-center gap-2">
        <IconButton :icon="Settings" label="Настройки" shortcut="G S" />
        <IconButton :icon="Search" label="Поиск" size="sm" variant="secondary" shortcut="Mod+K" />
        <IconButton :icon="Inbox" label="Активна" :active="pressed" @click="pressed = !pressed" />
        <IconButton :icon="Inbox" label="Отключена" disabled />
      </div>
    </section>

    <section class="flex flex-col gap-2">
      <h2 class="text-lg font-semibold">Input / Select</h2>
      <div class="flex flex-wrap items-end gap-2">
        <Input v-model="text" label="Название" placeholder="Введите" :icon="Search" />
        <Input v-model="text" label="Малое" size="sm" />
        <Input v-model="text" label="С ошибкой" error="Обязательное поле" />
        <Input v-model="text" label="Отключено" disabled />
        <Select v-model="sel" label="Статус" :options="opts" />
        <Select v-model="sel" label="Статус sm" size="sm" :options="opts" />
      </div>
    </section>

    <section class="flex flex-col gap-2">
      <h2 class="text-lg font-semibold">Menu / Popover / Dialog / ConfirmDialog / Tooltip</h2>
      <div class="flex flex-wrap items-center gap-2">
        <Menu :items="items">
          <template #trigger><IconButton :icon="MoreHorizontal" label="Ещё" /></template>
        </Menu>
        <Menu :items="items" label="Действия" />
        <Popover v-model:open="pop">
          <template #trigger><Button>Popover</Button></template>
          Содержимое поповера
        </Popover>
        <Button @click="dlg = true">Dialog</Button>
        <Button @click="cfm = true">ConfirmDialog</Button>
        <Tooltip content="Подсказка" shortcut="Mod+K"><Button>Tooltip</Button></Tooltip>
      </div>
      <Dialog v-model:open="dlg" title="Диалог" description="Описание">
        Содержимое
        <template #footer><Button variant="primary" @click="dlg = false">Готово</Button></template>
      </Dialog>
      <ConfirmDialog
        v-model:open="cfm"
        title="Удалить задачу?"
        description="Необратимо."
        confirm-label="Удалить"
      />
    </section>

    <section class="flex flex-col gap-2">
      <h2 class="text-lg font-semibold">Tabs / Chip / Badge / Kbd</h2>
      <Tabs
        v-model="tab"
        label="Вкладки"
        :items="[
          { value: 'a', label: 'Список', count: 12 },
          { value: 'b', label: 'Доска', icon: Inbox },
          { value: 'c', label: 'Календарь' },
        ]"
      />
      <div class="flex flex-wrap items-center gap-2">
        <Chip color="#4f46e5">Метка</Chip>
        <Chip removable remove-label="Убрать">Убираемая</Chip>
        <Badge>soft</Badge>
        <Badge variant="solid" color="#4f46e5">solid</Badge>
        <Badge variant="outline" color="#15803d">outline</Badge>
        <Badge dot color="#ea580c">dot</Badge>
        <Kbd keys="Mod+K" />
        <Kbd keys="G I" />
        <Kbd keys="Shift+Enter" />
      </div>
    </section>

    <section class="flex flex-col gap-2">
      <h2 class="text-lg font-semibold">Avatar / AvatarStack</h2>
      <div class="flex items-center gap-3">
        <Avatar
          v-for="s in ['xs', 'sm', 'md', 'lg'] as const"
          :key="s"
          name="Анна Белова"
          :size="s"
        />
        <AvatarStack :people="people" />
        <AvatarStack :people="people.slice(0, 2)" size="xs" />
      </div>
    </section>

    <section class="flex flex-col gap-2">
      <h2 class="text-lg font-semibold">Toolbar / EmptyState</h2>
      <Toolbar label="Панель">
        <Button size="sm" variant="ghost" :icon="Plus">Создать</Button>
        <template #end><IconButton :icon="Settings" label="Настройки" size="sm" /></template>
      </Toolbar>
      <EmptyState title="Задач нет" description="Создайте первую задачу." :icon="Inbox">
        <template #actions><Button variant="primary" :icon="Plus">Создать</Button></template>
      </EmptyState>
    </section>

    <section class="flex flex-col gap-2">
      <h2 class="text-lg font-semibold">Токены</h2>
      <div class="flex flex-wrap gap-1">
        <div
          v-for="n in 10"
          :key="n"
          class="flex size-10 items-end rounded-sm border border-border p-0.5 text-2xs"
          :style="{ background: `var(--color-neutral-${n})`, color: n > 5 ? '#fff' : '#000' }"
        >
          {{ n }}
        </div>
        <div
          class="flex h-10 w-24 items-center justify-center rounded-md bg-sidebar-bg text-xs text-sidebar-fg"
        >
          sidebar
        </div>
      </div>
      <p class="font-mono text-xs text-fg-muted">PLN-123 · 11/12/13/14/16/20</p>
    </section>
  </div>
</template>
