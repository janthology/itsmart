import { describe, expect, it } from 'vitest';
import { clearPasswordChangeReview, readPasswordChangeReview, savePasswordChangeReview } from './password-change-review';

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

describe('password-change review marker', () => {
  it('stores no credentials, scopes the marker to the user, and clears after review', () => {
    const s = storage();
    savePasswordChangeReview(s, 'user');
    expect(readPasswordChangeReview(s, 'user')).toBe(true);
    expect(readPasswordChangeReview(s, 'other')).toBe(false);
    expect([...s.values.values()]).toEqual(['pending']);
    clearPasswordChangeReview(s, 'user');
    expect(readPasswordChangeReview(s, 'user')).toBe(false);
  });
  it('fails closed for corrupt, unavailable, or silently discarding storage', () => {
    const s = storage();
    s.setItem('itsmart:password-change-review:v1:user', 'invalid');
    expect(() => readPasswordChangeReview(s, 'user')).toThrow(/Invalid/);
    const blocked = { getItem: () => { throw new Error('disabled'); }, setItem: () => { throw new Error('disabled'); }, removeItem: () => { throw new Error('disabled'); } };
    expect(() => readPasswordChangeReview(blocked, 'user')).toThrow('disabled');
    expect(() => savePasswordChangeReview(blocked, 'user')).toThrow('disabled');
    expect(() => clearPasswordChangeReview(blocked, 'user')).toThrow('disabled');
    const discards = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    expect(() => savePasswordChangeReview(discards, 'user')).toThrow(/not saved/);
  });
});
