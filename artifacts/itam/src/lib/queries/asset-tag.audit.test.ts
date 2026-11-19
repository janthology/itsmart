import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ result: { data: null as null | { id: string; asset_tag: string }, error: null as unknown }, rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: state.rpc } }));
import { assetCreationPayload, createAssetWithHistory } from './assets';

const asset = { name: 'Synthetic', category: 'laptop', status: 'active', pmRequired: false };
beforeEach(() => {
  state.rpc.mockReset();
  state.result = { data: { id: 'test-id', asset_tag: 'DOST02-ITA2026000001' }, error: null };
  state.rpc.mockImplementation(() => ({ single: async () => state.result }));
});

describe('atomic asset creation client', () => {
  it('sends a stable request ID and server-side tag/history payload', async () => {
    const row = await createAssetWithHistory('request-id', asset);
    expect(row.asset_tag).toBe('DOST02-ITA2026000001');
    expect(state.rpc).toHaveBeenCalledWith('create_asset_with_history', { p_request_id: 'request-id', p_asset: assetCreationPayload(asset) });
    expect(assetCreationPayload(asset)).not.toHaveProperty('asset_tag');
  });
  it('does not silently fall back when the request fails or returns an incomplete response', async () => {
    state.result = { data: null, error: new Error('synthetic network error') };
    await expect(createAssetWithHistory('request-id', asset)).rejects.toThrow('synthetic network error');
    state.result = { data: null, error: null };
    await expect(createAssetWithHistory('request-id', asset)).rejects.toThrow('incomplete');
  });
});
