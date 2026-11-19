import { describe, expect, it } from 'vitest';
import { clearAssetAttempt, fingerprintAssetPayload, readAssetAttempt, saveAssetAttempt } from './asset-creation-retry';

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const actor = 'test-actor';
const requestId = '40000000-0000-4000-8000-000000000019';

describe('tab-scoped asset creation retry record', () => {
  it('stores only a stable fingerprint and request id, isolates users, and clears on confirmation', async () => {
    const s = storage();
    const payload = '{"name":"Synthetic confidential asset"}';
    const digest = await fingerprintAssetPayload(payload);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprintAssetPayload(payload)).toBe(digest);
    expect(await fingerprintAssetPayload('{"name":"Another"}')).not.toBe(digest);
    const attempt = { version: 1 as const, requestId, fingerprint: digest };
    saveAssetAttempt(s, actor, attempt);
    expect(readAssetAttempt(s, actor)).toEqual(attempt);
    expect(readAssetAttempt(s, 'another-user')).toBeNull();
    expect([...s.values.values()].join()).not.toContain('Synthetic confidential asset');
    clearAssetAttempt(s, actor);
    expect(readAssetAttempt(s, actor)).toBeNull();
  });
  it('rejects malformed or modified data and does not silently start over', () => {
    const s = storage();
    s.setItem('itsmart:asset-creation:v1:test-actor', '{not json');
    expect(() => readAssetAttempt(s, actor)).toThrow();
    s.setItem('itsmart:asset-creation:v1:test-actor', JSON.stringify({version: 1,requestId:'bad',fingerprint:'a'.repeat(64)}));
    expect(() => readAssetAttempt(s, actor)).toThrow();
    clearAssetAttempt(s, actor);
    expect(readAssetAttempt(s, actor)).toBeNull();
  });
  it('reports read/write/remove failures instead of claiming a durable retry record', () => {
    const throws = { getItem: () => { throw new Error('disabled'); }, setItem: () => { throw new Error('disabled'); }, removeItem: () => { throw new Error('disabled'); } };
    const attempt = { version: 1 as const, requestId, fingerprint:'a'.repeat(64) };
    expect(() => readAssetAttempt(throws, actor)).toThrow('disabled');
    expect(() => saveAssetAttempt(throws, actor, attempt)).toThrow('disabled');
    expect(() => clearAssetAttempt(throws, actor)).toThrow('disabled');
    const discards = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    expect(() => saveAssetAttempt(discards, actor, attempt)).toThrow('not stored');
  });
});
