import { describe, it, expect } from 'vitest';
import { nextMaintenanceDate, pmIsOverdue, todayInManila } from './maintenance';

describe('maintenance date rules', () => {
  it('uses Manila calendar dates independently of browser time zone', () => {
    expect(todayInManila(new Date('2026-01-01T16:00:00Z'))).toBe('2026-01-02');
  });
  it('clamps month ends and leap days', () => {
    expect(nextMaintenanceDate('2025-11-30', 'server')).toBe('2026-02-28');
    expect(nextMaintenanceDate('2024-02-29', 'other')).toBe('2025-02-28');
    expect(nextMaintenanceDate('2026-01-31', 'laptop')).toBe('2026-07-31');
  });
  it('does not mark a due-today date overdue', () => {
    expect(pmIsOverdue('2026-10-28', '2026-10-28')).toBe(false);
    expect(pmIsOverdue('2026-10-27', '2026-10-28')).toBe(true);
  });
});
