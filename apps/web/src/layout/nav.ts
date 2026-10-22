import { computed, ref, type Ref } from 'vue';
import { useSpaces } from '../tasks';

export interface NavSpace {
  id: string;
  name: string;
  projects: { id: string; name: string; prefix: string }[];
}
export interface NavFavorite {
  id: string;
  name: string;
  to: string;
}

export function useNavData(): { spaces: Readonly<Ref<NavSpace[]>>; favorites: Ref<NavFavorite[]> } {
  const src = useSpaces();
  const spaces = computed<NavSpace[]>(() =>
    (src.value ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      projects: s.projects.map((p) => ({ id: p.id, name: p.name, prefix: p.key })),
    })),
  );
  return { spaces, favorites: ref([]) }; // сущности «избранное» пока нет
}
