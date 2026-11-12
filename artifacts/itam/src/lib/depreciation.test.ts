import { describe, expect, it } from 'vitest';
import { computeDepreciation } from './depreciation';

describe('depreciation estimates', () => {
  it('returns unavailable percentage for zero cost', () => {
    expect(computeDepreciation(0, '2020-01-01', '2026-01-01')).toMatchObject({ accumulated: 0, currentValue: 0, pctDepreciated: null });
  });
  it('does not depreciate purchases before their purchase date', () => {
    expect(computeDepreciation(5000, '2027-01-01', '2026-01-01')).toMatchObject({ ageYears: 0, accumulated: 0, currentValue: 5000, pctDepreciated: 0 });
  });
  it('caps accumulated depreciation at cost and uses unrounded age', () => {
    expect(computeDepreciation(5000, '2020-01-01', '2026-01-01')).toMatchObject({ accumulated: 5000, currentValue: 0, pctDepreciated: 100 });
    expect(computeDepreciation(5000, '2025-01-01', '2026-01-01')).toMatchObject({ accumulated: 999.32, currentValue: 4000.68, pctDepreciated: 20 });
  });
  it('rejects malformed dates and negative or non-finite purchase values', () => {
    expect(computeDepreciation(500, '2026-02-30', '2026-03-01')).toBeNull();
    expect(computeDepreciation(-1, '2020-01-01', '2026-01-01')).toBeNull();
    expect(computeDepreciation(NaN, '2020-01-01', '2026-01-01')).toBeNull();
  });
});
