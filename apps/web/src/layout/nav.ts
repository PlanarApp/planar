import { ref, type Ref } from 'vue';

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

// Данных реплики ещё нет: заполнят WB-4/WB-10.
const spaces = ref<NavSpace[]>([]);
const favorites = ref<NavFavorite[]>([]);

export function useNavData(): { spaces: Ref<NavSpace[]>; favorites: Ref<NavFavorite[]> } {
  return { spaces, favorites };
}
