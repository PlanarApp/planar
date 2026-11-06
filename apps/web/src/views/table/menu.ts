import { shallowRef, type ComputedRef } from 'vue';

export interface TableColumnsMenu {
  items: ComputedRef<{ id: string; label: string; on: boolean; locked: boolean }[]>;
  toggle: (id: string, on: boolean) => void;
}

/** the mounted Table's columns — the «Вид» menu shows them instead of «Поля» (one table on screen) */
export const tableColumns = shallowRef<TableColumnsMenu | null>(null);
