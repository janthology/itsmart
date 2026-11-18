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

describe('create-user partial failures', () => {
  it('characterizes an apparently successful response after a zero-row profile upsert', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) return json({ id: caller });
      if (url.includes('/rest/v1/profiles') && !init?.method) return json([{ role: 'administrator', is_active: true }]);
      if (url.endsWith('/auth/v1/admin/users') && init?.method === 'POST') return json({ id: target });
      if (url.includes('/rest/v1/profiles') && init?.method === 'POST') return json([]);
      throw new Error('unexpected request');
    });
    const response = await loadFunction('create-user', fetch as unknown as typeof globalThis.fetch)(request({ email: 'synthetic@example.test', fullName: 'Synthetic', role: 'support_staff' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, userId: target });
  });
  it('characterizes ignored rollback failures after a rejected profile upsert', async () => {
    let cleanupAttempted = false;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) return json({ id: caller });
      if (url.includes('/rest/v1/profiles') && !init?.method) return json([{ role: 'administrator', is_active: true }]);
      if (url.endsWith('/auth/v1/admin/users') && init?.method === 'POST') return json({ id: target });
      if (url.includes('/rest/v1/profiles') && init?.method === 'POST') return json({ message: 'profile failed' }, 500);
      if (url.includes('/auth/v1/admin/users/') && init?.method === 'DELETE') { cleanupAttempted = true; return json({ message: 'cleanup failed' }, 500); }
      throw new Error('unexpected request');
    });
    const response = await loadFunction('create-user', fetch as unknown as typeof globalThis.fetch)(request({ email: 'synthetic@example.test', fullName: 'Synthetic', role: 'support_staff' }));
    expect(cleanupAttempted).toBe(true);
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty('temporaryPassword');
  });
});
