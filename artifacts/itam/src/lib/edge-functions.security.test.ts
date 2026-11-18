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

describe('reset-password partial failures', () => {
  it('characterizes a profile failure after Auth already accepted a new password', async () => {
    let authUpdated = false;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) return json({ id: caller });
      if (url.includes('/rest/v1/profiles') && !init?.method) return json([{ role: 'administrator', is_active: true }]);
      if (url.includes('/auth/v1/admin/users/') && init?.method === 'PUT') { authUpdated = true; return json({ id: target }); }
      if (url.includes('/rest/v1/profiles') && init?.method === 'PATCH') return json({ message: 'Synthetic failure' }, 500);
      throw new Error('unexpected request');
    });
    const response = await loadFunction('reset-password', fetch as unknown as typeof globalThis.fetch)(request({ userId: target }));
    expect(authUpdated).toBe(true);
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty('temporaryPassword');
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/sessions'))).toBe(false);
  });
  it('characterizes an unsuccessful session revocation response being ignored', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) return json({ id: caller });
      if (url.includes('/rest/v1/profiles') && !init?.method) return json([{ role: 'administrator', is_active: true }]);
      if (url.includes('/auth/v1/admin/users/') && init?.method === 'PUT') return json({ id: target });
      if (url.includes('/rest/v1/profiles') && init?.method === 'PATCH') return json([{ id: target }]);
      if (url.endsWith('/sessions')) return json({ message: 'Synthetic rejection' }, 500);
      throw new Error('unexpected request');
    });
    const response = await loadFunction('reset-password', fetch as unknown as typeof globalThis.fetch)(request({ userId: target }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.temporaryPassword).toHaveLength(20);
  });
});

describe('create-user failure handling', () => {
  const body = { email: 'synthetic@example.test', fullName: 'Synthetic', role: 'support_staff' };
  const profile = { id: target, role: 'support_staff', is_active: true, must_change_password: true };
  const setup = (options: { create?: Response | Error; profile?: Response | Error; cleanup?: Response | Error } = {}) => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) return json({ id: caller });
      if (url.includes('/rest/v1/profiles') && !init?.method) return json([{ role: 'administrator', is_active: true }]);
      let result: Response | Error;
      if (url.endsWith('/auth/v1/admin/users') && init?.method === 'POST') result = options.create ?? json({ id: target });
      else if (url.includes('/rest/v1/profiles') && init?.method === 'POST') result = options.profile ?? json([profile]);
      else if (url.includes('/auth/v1/admin/users/') && init?.method === 'DELETE') result = options.cleanup ?? json({});
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
