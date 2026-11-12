import { todayInManila } from './maintenance';

/** Straight-line estimate over five years, using Philippine calendar dates.
 * Future purchases have not started depreciating; zero cost has no meaningful percentage.
 * Invalid historical inputs are reported as unavailable, not fabricated values. */
export function computeDepreciation(purchaseValue: number, purchaseDate: string, today = todayInManila()) {
  if (!Number.isFinite(purchaseValue) || purchaseValue < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const start = Date.parse(`${purchaseDate}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString().slice(0, 10) !== purchaseDate || new Date(end).toISOString().slice(0, 10) !== today) return null;
  const age = Math.max(0, (end - start) / (86400000 * 365.25));
  const annual = purchaseValue / 5;
  const accumulated = Math.min(annual * age, purchaseValue);
  const round = (n: number) => +n.toFixed(2);
  return {
    ageYears: round(age), annualDep: round(annual), accumulated: round(accumulated),
    currentValue: round(Math.max(purchaseValue - accumulated, 0)),
    pctDepreciated: purchaseValue === 0 ? null : Math.min(Math.round(accumulated / purchaseValue * 100), 100),
  };
}
