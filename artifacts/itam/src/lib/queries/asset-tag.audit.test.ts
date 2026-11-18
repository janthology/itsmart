import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ result: { data: null as null | { asset_tag: string }[], error: null as unknown } }));
vi.mock('../supabase', () => ({ supabase: { from: () => ({ select: () => ({ ilike: () => ({ order: () => ({ limit: async () => state.result }) }) }) }) } }));
import { generateNextAssetTag } from './assets';
afterEach(() => vi.useRealTimers());

describe('asset tag generation characterization', () => {
  it('concurrent callers can generate the same proposed tag', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
    state.result = { data: [{ asset_tag: 'DOST02-ITA2026000005' }], error: null };
    const [first, second] = await Promise.all([generateNextAssetTag(), generateNextAssetTag()]);
    expect(first).toBe('DOST02-ITA2026000006');
    expect(second).toBe(first);
  });
  it('silently proposes the first tag after a lookup error', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
    state.result = { data: null, error: new Error('synthetic network error') };
    expect(await generateNextAssetTag()).toBe('DOST02-ITA2026000001');
  });
});
