import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Handler = (request: Request) => Promise<Response>;
const caller = '00000000-0000-4000-8000-000000000001';
const target = '00000000-0000-4000-8000-000000000002';

// Execute the real Edge Function source in an isolated JS context. All fetches
// are supplied by the test, so no real Supabase request can be made.
function loadFunction(name: 'create-user' | 'reset-password', fetch: typeof globalThis.fetch): Handler {
  let handler: Handler | undefined;
  const source = readFileSync(new URL(`../../../../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
  const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  runInNewContext(script, {
    Deno: { serve: (fn: Handler) => { handler = fn; }, env: { get: (key: string) => ({ SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' } as Record<string, string>)[key] } },
    crypto: webcrypto, fetch, Request, Response, URL, Uint32Array, console,
  });
  if (!handler) throw new Error('Function did not register a handler');
  return handler;
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const request = (body: unknown, authorized = true) => new Request('https://synthetic.invalid/function', { method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer synthetic-user-token' } : {}) }, body: JSON.stringify(body) });

for (const name of ['create-user', 'reset-password'] as const) {
  describe(`${name}: authorization`, () => {
    it('allows preflight, rejects non-POST and missing bearer without fetching', async () => {
      const fetch = vi.fn(() => { throw new Error('unexpected fetch'); });
      const handler = loadFunction(name, fetch as unknown as typeof globalThis.fetch);
      expect((await handler(new Request('https://synthetic.invalid', { method: 'OPTIONS' }))).status).toBe(204);
      expect((await handler(new Request('https://synthetic.invalid'))).status).toBe(405);
      expect((await handler(request({}, false))).status).toBe(401);
      expect(fetch).not.toHaveBeenCalled();
    });
    it.each([
      ['invalid bearer', null, null], ['support', { id: caller }, { role: 'support_staff', is_active: true }],
      ['inactive admin', { id: caller }, { role: 'administrator', is_active: false }],
    ])('rejects %s before privileged operation', async (_label, user, profile) => {
      const fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/auth/v1/user')) return user ? json(user) : json({}, 401);
        if (url.includes('/rest/v1/profiles')) return json(profile ? [profile] : []);
        throw new Error('unexpected privileged request');
      });
      const handler = loadFunction(name, fetch as unknown as typeof globalThis.fetch);
      expect((await handler(request({ userId: target, email: 'synthetic@example.test', fullName: 'Synthetic' }))).status).toBe(403);
      expect(fetch.mock.calls.length).toBeLessThanOrEqual(2);
    });
  });
}

describe('reset-password failure handling', () => {
  const flag = { id: target, must_change_password: true };
  const setup = (options: { firstFlag?: Response | Error; secondFlag?: Response | Error; auth?: Response | Error; begin?: Response | Error; finish?: Response | Error } = {}) => {
    let patches = 0;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) return json({ id: caller });
      if (url.includes('/rest/v1/profiles') && !init?.method) return json([{ role: 'administrator', is_active: true }]);
      let result: Response | Error;
      if (url.includes('/rest/v1/profiles') && init?.method === 'PATCH') {
        patches++;
        result = (patches === 1 ? options.firstFlag : options.secondFlag) ?? json([flag]);
      } else if (url.includes('/auth/v1/admin/users/') && init?.method === 'PUT') result = options.auth ?? json({ id: target });
      else if (url.endsWith('/rest/v1/rpc/password_gate_begin_reset')) result = options.begin ?? new Response(null, { status: 204 });
      else if (url.endsWith('/rest/v1/rpc/password_gate_finish_reset')) result = options.finish ?? new Response(null, { status: 204 });
      else throw new Error('unexpected privileged request');
      if (result instanceof Error) throw result;
      return result;
    });
    return { fetch, handler: loadFunction('reset-password', fetch as unknown as typeof globalThis.fetch) };
  };
  it('verifies the flag before and after the Auth change, without claiming session revocation', async () => {
    const { handler, fetch } = setup();
    const response = await handler(request({ userId: target }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, profileFlag: 'confirmed', sessionRevocation: 'unverified' });
    expect(payload.temporaryPassword).toHaveLength(20);
    expect(fetch.mock.calls.map(([url, init]) => (String(url).includes('/rpc/') ? 'RPC ' + String(url).split('/rpc/')[1] : init?.method ?? 'GET'))).toEqual(['GET', 'GET', 'PATCH', 'RPC password_gate_begin_reset', 'PUT', 'RPC password_gate_finish_reset', 'PATCH']);
    expect(payload).toMatchObject({ gateConfirmed: true });
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/sessions'))).toBe(false);
  });
  it('rejects resetting the caller’s own account without touching it', async () => {
    const { handler, fetch } = setup();
    const response = await handler(request({ userId: caller }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'self_reset_forbidden' });
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'PATCH' || init?.method === 'PUT')).toBe(false);
  });
  it.each([
    ['zero rows', () => json([])],
    ['wrong ID', () => json([{ ...flag, id: caller }])],
    ['wrong flag', () => json([{ ...flag, must_change_password: false }])],
    ['rejected request', () => json({}, 500)],
    ['lost response', () => new Error('network failure')],
    ['invalid JSON', () => new Response('bad JSON')],
  ])('does not change the password if the first flag response is %s', async (_label, response) => {
    const { handler, fetch } = setup({ firstFlag: response() });
    const result = await handler(request({ userId: target }));
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ code: 'profile_unconfirmed' });
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });
  it.each([
    ['server error', () => json({}, 500)],
    ['validation error', () => json({}, 400)],
    ['lost response', () => new Error('network failure')],
  ])('does not claim reset failure is reversible after %s', async (_label, response) => {
    const { handler, fetch } = setup({ auth: response() });
    const result = await handler(request({ userId: target }));
    expect(result.status).toBe(503);
    const payload = await result.json();
    expect(payload).toMatchObject({ code: 'reset_unconfirmed' });
    expect(payload).not.toHaveProperty('temporaryPassword');
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  });
  it.each([
    ['server error', () => json({}, 500)],
    ['zero rows', () => json([])],
    ['lost response', () => new Error('network failure')],
  ])('returns the temporary password with a warning after Auth succeeds and flag recheck has %s', async (_label, response) => {
    const { handler } = setup({ secondFlag: response() });
    const result = await handler(request({ userId: target }));
    expect(result.status).toBe(200);
    const payload = await result.json();
    expect(payload).toMatchObject({ profileFlag: 'unconfirmed', sessionRevocation: 'unverified' });
    expect(payload.temporaryPassword).toHaveLength(20);
  });
});

describe('create-user failure handling', () => {
  const body = { email: 'synthetic@example.test', fullName: 'Synthetic', role: 'support_staff' };
  const profile = { id: target, role: 'support_staff', is_active: true, must_change_password: true };
  const setup = (options: { create?: Response | Error; profile?: Response | Error; cleanup?: Response | Error; begin?: Response | Error; finish?: Response | Error } = {}) => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) return json({ id: caller });
      if (url.includes('/rest/v1/profiles') && !init?.method) return json([{ role: 'administrator', is_active: true }]);
      let result: Response | Error;
      if (url.endsWith('/auth/v1/admin/users') && init?.method === 'POST') result = options.create ?? json({ id: target });
      else if (url.includes('/rest/v1/profiles') && init?.method === 'POST') result = options.profile ?? json([profile]);
      else if (url.includes('/auth/v1/admin/users/') && init?.method === 'DELETE') result = options.cleanup ?? json({});
      else if (url.endsWith('/rest/v1/rpc/password_gate_begin_reset')) result = options.begin ?? new Response(null, { status: 204 });
      else if (url.endsWith('/rest/v1/rpc/password_gate_finish_reset')) result = options.finish ?? new Response(null, { status: 204 });
      else throw new Error('unexpected request');
      if (result instanceof Error) throw result;
      return result;
    });
    return { fetch, handler: loadFunction('create-user', fetch as unknown as typeof globalThis.fetch) };
  };
  it('returns the temporary password only after the exact profile is confirmed', async () => {
    const { handler, fetch } = setup();
    const response = await handler(request(body));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result).toMatchObject({ success: true, userId: target });
    expect(result.temporaryPassword).toHaveLength(20);
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });
  it.each([
    ['zero rows', () => json([])],
    ['wrong id', () => json([{ ...profile, id: caller }])],
    ['wrong role', () => json([{ ...profile, role: 'general_user' }])],
    ['flag not set', () => json([{ ...profile, must_change_password: false }])],
    ['http failure', () => json({ message: 'failed' }, 500)],
    ['lost response', () => new Error('network failure')],
    ['invalid JSON', () => new Response('not JSON')],
  ])('%s profile response attempts and checks compensation', async (_label, response) => {
    const { handler, fetch } = setup({ profile: response() });
    const result = await handler(request(body));
    expect(result.status).toBe(500);
    const payload = await result.json();
    expect(payload).toMatchObject({ code: 'cleanup_requested', userId: target });
    expect(payload).not.toHaveProperty('temporaryPassword');
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  });
  it.each([
    ['non-success response', () => json({ message: 'failed' }, 500)],
    ['lost response', () => new Error('network failure')],
  ])('reports cleanup as unconfirmed on %s', async (_label, response) => {
    const { handler } = setup({ profile: json([], 200), cleanup: response() });
    const result = await handler(request(body));
    expect(result.status).toBe(500);
    const payload = await result.json();
    expect(payload).toMatchObject({ code: 'cleanup_unconfirmed', userId: target });
    expect(payload).not.toHaveProperty('temporaryPassword');
  });
  it.each([
    ['lost creation response', () => new Error('network failure')],
    ['server error', () => json({}, 500)],
    ['missing ID', () => json({})],
    ['invalid JSON', () => new Response('not JSON')],
  ])('does not claim the creation failed after %s', async (_label, response) => {
    const { handler, fetch } = setup({ create: response() });
    const result = await handler(request(body));
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ code: 'creation_unconfirmed' });
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });
  it('rejects whitespace-only fields before the Auth request', async () => {
    const { handler, fetch } = setup();
    expect((await handler(request({ ...body, fullName: '  ' }))).status).toBe(400);
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});

describe('reset-password gate recording (Phase 2)', () => {
  const flagged = { id: target, must_change_password: true };
  const setupReset = (options: { firstFlag?: Response | Error; begin?: Response | Error; auth?: Response | Error; finish?: Response | Error } = {}) => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) return json({ id: caller });
      if (url.includes('/rest/v1/profiles') && !init?.method) return json([{ role: 'administrator', is_active: true }]);
      let result: Response | Error;
      if (url.includes('/rest/v1/profiles') && init?.method === 'PATCH') result = options.firstFlag ?? json([flagged]);
      else if (url.includes('/auth/v1/admin/users/') && init?.method === 'PUT') result = options.auth ?? json({ id: target });
      else if (url.endsWith('/rest/v1/rpc/password_gate_begin_reset')) result = options.begin ?? new Response(null, { status: 204 });
      else if (url.endsWith('/rest/v1/rpc/password_gate_finish_reset')) result = options.finish ?? new Response(null, { status: 204 });
      else throw new Error('unexpected privileged request');
      if (result instanceof Error) throw result;
      return result;
    });
    return { fetch, handler: loadFunction('reset-password', fetch as unknown as typeof globalThis.fetch) };
  };
  const rpcNames = (fetch: { mock: { calls: unknown[][] } }) => fetch.mock.calls.map(([u]) => String(u)).filter(u => u.includes('/rpc/')).map(u => u.split('/rpc/')[1]);
  const puts = (fetch: { mock: { calls: unknown[][] } }) => fetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT').length;

  it('refuses before any Auth change when another operation holds the gate', async () => {
    const { handler, fetch } = setupReset({ begin: json({ message: 'Password operation already in progress' }, 400) });
    const response = await handler(request({ userId: target }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'reset_unavailable' });
    expect(puts(fetch)).toBe(0);
    expect(rpcNames(fetch)).toEqual(['password_gate_begin_reset']);
  });
  it('stops without an Auth change when the gate lock response is lost', async () => {
    const { handler, fetch } = setupReset({ begin: new Error('network failure') });
    const response = await handler(request({ userId: target }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'reset_unconfirmed' });
    expect(puts(fetch)).toBe(0);
    expect(rpcNames(fetch)).toEqual(['password_gate_begin_reset']);
  });
  it('sets the flag before taking the gate lock, so a failed flag write leaves no lock', async () => {
    const { handler, fetch } = setupReset({ firstFlag: json({}, 500) });
    const response = await handler(request({ userId: target }));
    expect(await response.json()).toMatchObject({ code: 'profile_unconfirmed' });
    expect(rpcNames(fetch)).toEqual([]);
    expect(puts(fetch)).toBe(0);
  });
  it('keeps the new password and warns when the gate could not be recorded after Auth succeeds', async () => {
    const { handler, fetch } = setupReset({ finish: json({}, 500) });
    const response = await handler(request({ userId: target }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ success: true, gateConfirmed: false, sessionRevocation: 'unverified' });
    expect(payload.temporaryPassword).toHaveLength(20);
    expect(rpcNames(fetch)).toEqual(['password_gate_begin_reset', 'password_gate_finish_reset']);
  });
  it('does not complete the gate when the Auth change fails, leaving the lock held', async () => {
    const { handler, fetch } = setupReset({ auth: json({}, 500) });
    const response = await handler(request({ userId: target }));
    expect(await response.json()).toMatchObject({ code: 'reset_unconfirmed' });
    expect(rpcNames(fetch)).toEqual(['password_gate_begin_reset']);
  });
});

describe('create-user gate recording (Phase 2)', () => {
  const body = { email: 'synthetic@example.test', fullName: 'Synthetic', role: 'general_user' };
  const profile = { id: target, role: 'general_user', is_active: true, must_change_password: true };
  const setupCreate = (options: { begin?: Response | Error; finish?: Response | Error } = {}) => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) return json({ id: caller });
      if (url.includes('/rest/v1/profiles') && !init?.method) return json([{ role: 'administrator', is_active: true }]);
      let result: Response | Error;
      if (url.endsWith('/auth/v1/admin/users') && init?.method === 'POST') result = json({ id: target });
      else if (url.includes('/rest/v1/profiles') && init?.method === 'POST') result = json([profile]);
      else if (url.endsWith('/rest/v1/rpc/password_gate_begin_reset')) result = options.begin ?? new Response(null, { status: 204 });
      else if (url.endsWith('/rest/v1/rpc/password_gate_finish_reset')) result = options.finish ?? new Response(null, { status: 204 });
      else if (url.includes('/auth/v1/admin/users/') && init?.method === 'DELETE') result = json({});
      else throw new Error('unexpected request');
      if (result instanceof Error) throw result;
      return result;
    });
    return { fetch, handler: loadFunction('create-user', fetch as unknown as typeof globalThis.fetch) };
  };
  it('records the gate state before returning the temporary password', async () => {
    const { handler, fetch } = setupCreate();
    const response = await handler(request(body));
    expect(response.status).toBe(200);
    expect((await response.json()).temporaryPassword).toHaveLength(20);
    const urls = fetch.mock.calls.map(([u]) => String(u)).filter(u => u.includes('/rpc/')).map(u => u.split('/rpc/')[1]);
    expect(urls).toEqual(['password_gate_begin_reset', 'password_gate_finish_reset']);
  });
  it('withholds the temporary password and skips cleanup when the gate lock response is lost', async () => {
    const { handler, fetch } = setupCreate({ begin: new Error('network failure') });
    const response = await handler(request(body));
    const payload = await response.json();
    expect(response.status).toBe(503);
    expect(payload).toMatchObject({ code: 'gate_unconfirmed', userId: target });
    expect(payload).not.toHaveProperty('temporaryPassword');
    expect(fetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
  });
  it('withholds the temporary password when the gate completion is refused', async () => {
    const { handler } = setupCreate({ finish: json({ message: 'Password operation mismatch' }, 400) });
    const response = await handler(request(body));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'gate_unconfirmed' });
  });
});

