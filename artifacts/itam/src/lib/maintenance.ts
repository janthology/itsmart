/** Date-only maintenance rules use Philippine calendar dates, never browser-local midnight. */
export function todayInManila(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const intervals: Record<string, number> = {
  server: 3, networking: 3, laptop: 6, desktop: 6, printer: 6,
  monitor: 12, phone: 12, tablet: 12, peripheral: 12, other: 12,
};

/** Clamp to the last day in the target month instead of rolling into the next. */
export function nextMaintenanceDate(date: string, category: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + (intervals[category] ?? 12), 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

export function pmIsOverdue(nextDate: string | null | undefined, today = todayInManila()): boolean {
  return !!nextDate && nextDate < today;
}
