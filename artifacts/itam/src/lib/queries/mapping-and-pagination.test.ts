import { describe, expect, it, vi } from 'vitest';
import { fetchAllRows, mapAsset, mapTicket, mapUser } from './shared';

describe('database row mapping', () => {
  it('maps user defaults without treating an inactive user as active', () => {
    expect(mapUser({ id: 'u1', role: 'support_staff', is_active: false })).toMatchObject({
      id: 'u1', role: 'support_staff', isActive: false, fullName: '', email: '', department: null,
    });
  });
  it('maps asset assignment and explicit PM opt-out', () => {
    const asset = mapAsset({ id: 'a1', asset_tag: 'A1', name: 'Device', category: 'laptop', status: 'maintenance', pm_required: false, assigned_to_profile: { id: 'u1', full_name: 'Person', role: 'general_user' } });
    expect(asset).toMatchObject({ assetTag: 'A1', pmRequired: false, lastPmDate: null, nextPmDate: null, assignedTo: { id: 'u1', fullName: 'Person' } });
  });
  it('maps legacy tickets safely, preserving hold time and resolution timestamps', () => {
    const ticket = mapTicket({ id: 't1', title: 'Problem', status: 'closed', priority: 'high', created_at: '2025-01-01', updated_at: '2025-01-02', resolved_at: '2025-01-02', total_hold_seconds: 3600 });
    expect(ticket).toMatchObject({ type: 'other', resolvedAt: '2025-01-02', totalHoldSeconds: 3600, lastActivityAt: '2025-01-02', createdBy: { fullName: 'Unknown' }, assignedTo: null });
  });
});

describe('full-table pagination', () => {
  it('fetches a full page and stops after a short second page', async () => {
    const all = Array.from({ length: 1007 }, (_, i) => ({ id: i }));
    const range = vi.fn(async (from: number, to: number) => ({ data: all.slice(from, to + 1), error: null }));
    expect(await fetchAllRows(() => ({ range }))).toEqual(all);
    expect(range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });
  it('makes a final empty request when a result exactly fills a page', async () => {
    const range = vi.fn(async (from: number) => ({ data: from === 0 ? Array.from({ length: 1000 }, (_, id) => ({ id })) : [], error: null }));
    expect(await fetchAllRows(() => ({ range }))).toHaveLength(1000);
    expect(range).toHaveBeenCalledTimes(2);
  });
  it('surfaces query errors rather than silently returning partial data', async () => {
    const error = new Error('network error');
    await expect(fetchAllRows(() => ({ range: async () => ({ data: null, error }) }))).rejects.toThrow('network error');
  });
});
