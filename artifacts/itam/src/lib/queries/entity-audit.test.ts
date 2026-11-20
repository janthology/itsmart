import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ calls: [] as Array<[string, ...unknown[]]>, result: { data: null as unknown, error: null as unknown } }));
vi.mock('../supabase', () => ({ supabase: { from: (name: string) => {
  mock.calls.push(['from', name]);
  const query: Record<string, unknown> = {};
  for (const name of ['select','order','limit','lt','eq']) query[name] = (...args: unknown[]) => { mock.calls.push([name, ...args]); return query; };
  query.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(mock.result).then(resolve,reject);
  query.maybeSingle = async () => mock.result;
  return query;
} } }));
import { AUDIT_PAGE_SIZE, fetchEntityAuditDetails, fetchEntityAuditPage } from './entity-audit';
const row = (id: string) => ({ id, occurred_at: '2026-01-01T00:00:00Z', entity_type: 'ticket', entity_id: 'synthetic-entity', operation: 'UPDATE', actor_id: null });
beforeEach(() => { mock.calls.length = 0; mock.result = {data: null,error: null}; });

describe('audit viewer read-only queries', () => {
  it('loads metadata only, requests one extra row, and preserves big integer cursors as text', async () => {
    mock.result.data = Array.from({length: AUDIT_PAGE_SIZE + 1},(_,i) => row(String(9007199254741000n - BigInt(i))));
    const page = await fetchEntityAuditPage(null);
    expect(page.rows).toHaveLength(AUDIT_PAGE_SIZE);
    expect(page.next).toBe('9007199254740976');
    expect(mock.calls).toContainEqual(['select','id::text,occurred_at,entity_type,entity_id,operation,actor_id']);
    expect(mock.calls).toContainEqual(['limit',AUDIT_PAGE_SIZE + 1]);
    expect(mock.calls.some(c => String(c[1]).includes('old_values'))).toBe(false);
    mock.calls.length = 0;
    await fetchEntityAuditPage(page.next);
    expect(mock.calls).toContainEqual(['lt','id','9007199254740976']);
  });
  it('loads sensitive snapshots only on explicit details request', async () => {
    mock.result.data = { old_values: { title: 'before' }, new_values: { title: 'after' } };
    expect(await fetchEntityAuditDetails('12')).toEqual(mock.result.data);
    expect(mock.calls).toContainEqual(['select','old_values,new_values']);
    expect(mock.calls).toContainEqual(['eq','id','12']);
  });
  it('rejects imprecise or invalid IDs and propagates data errors', async () => {
    mock.result.data = [{...row('12'), id: 12}];
    await expect(fetchEntityAuditPage(null)).rejects.toThrow(/Invalid audit row/);
    await expect(fetchEntityAuditPage('1,or.true')).rejects.toThrow(/Invalid audit cursor/);
    await expect(fetchEntityAuditDetails('1.5')).rejects.toThrow(/Invalid audit ID/);
    mock.result = {data: null,error: new Error('synthetic backend failure')};
    await expect(fetchEntityAuditPage(null)).rejects.toThrow('synthetic backend failure');
    await expect(fetchEntityAuditDetails('12')).rejects.toThrow('synthetic backend failure');
  });
  it('does not treat an inaccessible detail as an empty snapshot', async () => {
    await expect(fetchEntityAuditDetails('12')).rejects.toThrow(/not found or access denied/);
  });
});
