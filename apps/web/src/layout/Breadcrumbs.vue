<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ChevronDown, ChevronRight } from 'lucide-vue-next';
// reka (Menu) — outside the initial bundle
const Menu = defineAsyncComponent(() => import('../ui/Menu.vue'));
import { useBreakpoint } from '../ui/useBreakpoint';
import { useExtensions } from '../modules/registry';
import { useProject, useRootSpaceId, useSpaces, useWorkspace } from '../tasks/queries';
import { useSavedView } from '../views/saved/queries';
import { groupTab, groupUrl, type GroupLevel } from './groups';
import { useGroupTabs } from './useGroupTabs';
import type { MenuItem } from '../ui/Menu.vue';

const { t, te, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const { isMobile } = useBreakpoint();

// breadcrumbs: space / project / view; on other screens — the screen name
const projectId = computed(() => String(route.params.projectId ?? ''));
const inProject = computed(() => route.name === 'project' || route.name === 'savedView');
const project = useProject(() => (inProject.value ? projectId.value : ''));
const spaces = useSpaces();
const saved = useSavedView(() => (route.name === 'savedView' ? String(route.params.viewId) : ''));
const extViews = useExtensions('views');
const text = (l: string | { ru: string; en: string }) =>
  typeof l === 'object' ? l[locale.value as 'ru' | 'en'] : te(l) ? t(l) : l;
const viewLabel = computed(() => {
  if (route.name === 'savedView') return saved.value?.name ?? '';
  const v = String(route.params.view || 'list');
  if (groupTab(v) !== 'tasks') return t(`groups.tab.${v}`);
  const ext = extViews.value.find((e) => e.key === v);
  return ext ? text(ext.label) : te(`views.${v}`) ? t(`views.${v}`) : v;
});
const navItems = useExtensions('nav');
// module screen (/m/<id>/…): the module's nav-item label, otherwise the route's meta.title, otherwise the module name
const moduleTitle = computed(() => {
  const id = route.path.startsWith('/m/') ? route.path.split('/')[2] : '';
  if (!id) return '';
  const nav = navItems.value.find((n) => n.moduleId === id && 'label' in n);
  if (nav && 'label' in nav) return text(nav.label);
  const meta = route.meta.title;
  if (typeof meta === 'string' && meta) return te(meta) ? t(meta) : meta;
  return te(`topbar.modules.${id}`) ? t(`topbar.modules.${id}`) : id;
});
// a crumb — a link to its own level; ▾ — siblings at the level (spaces, the space's projects, tabs)
interface Crumb {
  label: string;
  to?: string;
  menu?: MenuItem[];
}
const rootId = useRootSpaceId();
const ws = useWorkspace();
const crumbLevel = computed<GroupLevel>(() =>
  inProject.value ? 'project' : route.name === 'space' ? 'space' : 'workspace',
);
const crumbTabs = useGroupTabs(crumbLevel);
const go = (to: string) => () => void router.push(to);
const crumbs = computed<Crumb[]>(() => {
  if (moduleTitle.value) return [{ label: moduleTitle.value }];
  const level = route.name === 'workspace' ? 'workspace' : route.name === 'space' ? 'space' : '';
  if (!level && !inProject.value)
    return [{ label: route.name ? t(`screens.${String(route.name)}`) : t('app.name') }];
  const all = (spaces.value ?? []).filter((x) => x.id !== rootId.value);
  const spaceId = level === 'space' ? String(route.params.spaceId) : project.value?.spaceId;
  const space = all.find((x) => x.id === spaceId);
  const out: Crumb[] = [{ label: ws.value.name, to: '/w' }];
  if (space)
    out.push({
      label: space.name,
      to: groupUrl('space', space.id),
      menu: all.map((x) => ({ id: x.id, label: x.name, onSelect: go(groupUrl('space', x.id)) })),
    });
  const p = project.value;
  if (inProject.value && p)
    out.push({
      label: p.name,
      to: groupUrl('project', p.id),
      menu: (space?.projects ?? []).map((x) => ({
        id: x.id,
        label: x.name,
        onSelect: go(groupUrl('project', x.id)),
      })),
    });
  const gl = inProject.value ? 'project' : (level as 'workspace' | 'space');
  const gid = inProject.value ? projectId.value : (spaceId ?? '');
  const tab = groupTab(inProject.value ? route.params.view : route.params.tab);
  out.push({
    label: inProject.value ? viewLabel.value : t(`groups.tab.${tab}`),
    menu: crumbTabs.value.map((k) => ({
      id: k,
      label: t(`groups.tab.${k}`),
      onSelect: go(groupUrl(gl, gid, k)),
    })),
  });
  return out.filter((c) => c.label);
});
</script>

<template>
  <nav :aria-label="t('topbar.breadcrumb')" class="min-w-0 flex-1">
    <h1
      class="flex items-center gap-1 truncate text-sm"
      :title="crumbs.map((c) => c.label).join(' / ')"
    >
      <template v-for="(c, i) in crumbs" :key="i">
        <template v-if="!isMobile || i >= crumbs.length - 2">
          <ChevronRight
            v-if="i && (!isMobile || i === crumbs.length - 1)"
            :size="12"
            class="shrink-0 text-fg-subtle"
            aria-hidden="true"
          />
          <span class="flex min-w-0 items-center">
            <RouterLink
              v-if="c.to && i < crumbs.length - 1"
              :to="c.to"
              class="max-w-40 truncate rounded-sm px-0.5 text-fg-muted outline-none hover:text-fg hover:underline focus-visible:ring-2 ring-focus"
              data-testid="crumb"
              >{{ c.label }}</RouterLink
            >
            <span
              v-else
              :class="[
                'truncate',
                i === crumbs.length - 1 ? 'font-medium' : 'max-w-40 text-fg-muted',
              ]"
              >{{ c.label }}</span
            >
            <Menu v-if="c.menu?.length" :items="c.menu" align="start">
              <template #trigger>
                <button
                  type="button"
                  :aria-label="t('topbar.crumbMenu', { name: c.label })"
                  data-testid="crumb-menu"
                  class="flex size-5! shrink-0 items-center justify-center rounded text-fg-subtle outline-none hover:bg-bg-muted hover:text-fg focus-visible:ring-2 ring-focus"
                >
                  <ChevronDown :size="12" />
                </button>
              </template>
            </Menu>
          </span>
        </template>
      </template>
    </h1>
  </nav>
</template>
