import type { HubSort } from "./ui-prefs";

export interface HubSortDates {
  created_at?: string | null;
  updated_at?: string | null;
  last_opened_at?: string | null;
}

/** Datas ausentes ficam no fim em ambas as direções; empates são estáveis. */
export function sortHubItems<T extends HubSortDates>(items: readonly T[], sort: HubSort): T[] {
  const field = sort.startsWith("opened_") ? "last_opened_at"
    : sort.startsWith("updated_") ? "updated_at" : "created_at";
  const direction = sort.endsWith("_asc") ? 1 : -1;
  const stamp = (item: T) => {
    const value = item[field];
    const date = value ? Date.parse(value) : NaN;
    return Number.isFinite(date) ? date : null;
  };
  return [...items].sort((a, b) => {
    const left = stamp(a), right = stamp(b);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return direction * (left - right);
  });
}
