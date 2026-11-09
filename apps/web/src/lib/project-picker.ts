import type { ProjectSummary } from '@ramesses/shared';

export type PickerSort = 'name' | 'rate';

export interface PickerRate {
  value: number;
  window: '1 h' | '24 h';
}

/**
 * The completion rate a project is judged by in the picker: the last hour, or the last day while
 * the hourly window has no sample. Zero is a real rate. Only the universal tracker reports rates.
 */
export function pickerRate(summary: ProjectSummary): PickerRate | null {
  if (summary.tracker !== 'universal') return null;
  if (summary.doneRate.h1 !== null) return { value: summary.doneRate.h1, window: '1 h' };
  if (summary.doneRate.h24 !== null) return { value: summary.doneRate.h24, window: '24 h' };
  return null;
}

/** Order picker rows by title, or by rate with the fastest first and unrated projects last. */
export function sortPickerEntries<T extends { name: string; title: string }>(
  entries: T[],
  mode: PickerSort,
  summaries: ReadonlyMap<string, ProjectSummary>,
): T[] {
  const byTitle = (a: T, b: T): number => a.title.localeCompare(b.title);
  if (mode === 'name') return [...entries].sort(byTitle);

  const rateOf = (entry: T): number | null => {
    const summary = summaries.get(entry.name);
    return summary ? (pickerRate(summary)?.value ?? null) : null;
  };
  return [...entries].sort((a, b) => {
    const rateA = rateOf(a);
    const rateB = rateOf(b);
    if (rateA === rateB) return byTitle(a, b);
    if (rateA === null) return 1;
    if (rateB === null) return -1;
    return rateB - rateA;
  });
}
