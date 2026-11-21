import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Runs the real change-password Edge Function source with every Auth and REST
// call mocked. No network request can reach Supabase.
type Handler = (request: Request) => Promise<Response>;
const userId = '00000000-0000-4000-8000-000000000011';
const currentPassword = 'Old-Synthetic-1';
const newPassword = 'New-Synthetic-2!';
const bearer = 'synthetic-user-token';
const verifyToken = 'synthetic-verification-token';

function loadFunction(fetch: typeof globalThis.fetch): Handler {
  let handler: Handler | undefined;
  const source = readFileSync(new URL('../../../../supabase/functions/change-password/index.ts', import.meta.url), 'utf8');
  const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const env: Record<string, string> = { SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' };
  runInNewContext(script, {
    Deno: { serve: (fn: Handler) => { handler = fn; }, env: { get: (key: string) => env[key] } },
    fetch, Request, Response, URL, JSON, Date, console,
  });
  if (!handler) throw new Error('Function did not register a handler');
  return handler;
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const post = (body: unknown, auth: string | null = bearer) => new Request('https://synthetic.invalid/change-password', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const valid = { currentPassword, newPassword };

interface Steps {
  user?: Response | Error;
  profile?: Response | Error;
  token?: Response | Error;
  put?: Response | Error;
  logout?: Response | Error;
  patch?: Response | Error;
}
// Routes each mocked call by URL and method, recording order and bodies.
function setup(steps: Steps = {}) {
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body?: string }> = [];
  const pick = (value: Response | Error | undefined, fallback: () => Response) => {
    if (value instanceof Error) throw value;
    return value ?? fallback();
  };
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined });
    if (url.endsWith('/auth/v1/user') && method === 'GET') return pick(steps.user, () => json({ id: userId, email: 'synthetic@example.test' }));
    if (url.includes('/rest/v1/profiles') && method === 'GET') return pick(steps.profile, () => json([{ id: userId, is_active: true, must_change_password: true }]));
    if (url.includes('grant_type=password')) return pick(steps.token, () => json({ access_token: verifyToken, user: { id: userId } }));
    if (url.endsWith('/auth/v1/user') && method === 'PUT') return pick(steps.put, () => json({ id: userId }));
    if (url.includes('/auth/v1/logout')) return pick(steps.logout, () => new Response(null, { status: 204 }));
    if (url.includes('/rest/v1/profiles') && method === 'PATCH') return pick(steps.patch, () => json([{ id: userId, must_change_password: false }]));
    throw new Error(`unexpected request ${method} ${url}`);
  });
  return { fetch, calls, handler: loadFunction(fetch as unknown as typeof globalThis.fetch) };
}
const methods = (calls: Array<{ method: string; url: string }>) => calls.map(c => `${c.method} ${c.url.replace('https://synthetic.invalid', '')}`);

describe('change-password Edge Function: request validation', () => {
  it('answers preflight and rejects non-POST without any upstream call', async () => {
    const { handler, fetch } = setup();
    expect((await handler(new Request('https://synthetic.invalid', { method: 'OPTIONS' }))).status).toBe(204);
    expect((await handler(new Request('https://synthetic.invalid', { method: 'GET' }))).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a missing bearer token without any upstream call', async () => {
    const { handler, fetch } = setup();
    expect((await handler(post(valid, null))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['missing fields', { currentPassword }],
    ['non-string field', { currentPassword, newPassword: 12345678 }],
    ['too short', { currentPassword, newPassword: 'Ab1!' }],
    ['missing uppercase', { currentPassword, newPassword: 'new-synthetic-2!' }],
    ['missing digit', { currentPassword, newPassword: 'New-Synthetic!' }],
    ['missing special', { currentPassword, newPassword: 'NewSynthetic2' }],
    ['default password', { currentPassword: 'x', newPassword: 'DOSTRO2' }],
    ['same password', { currentPassword: newPassword, newPassword }],
  ])('rejects %s before any upstream call', async (_label, body) => {
    const { handler, fetch } = setup();
    const response = await handler(post(body));
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('change-password Edge Function: fail-closed ordering', () => {
  it('rejects an invalid bearer before reading profiles or changing anything', async () => {
    const { handler, calls } = setup({ user: json({}, 401) });
    expect((await handler(post(valid))).status).toBe(401);
    expect(methods(calls)).toEqual(['GET /auth/v1/user']);
  });

  it('rejects an inactive account before verifying the password', async () => {
    const { handler, calls } = setup({ profile: json([{ id: userId, is_active: false, must_change_password: true }]) });
    expect((await handler(post(valid))).status).toBe(403);
    expect(calls.some(c => c.url.includes('grant_type=password'))).toBe(false);
  });

  it('reports a wrong current password without any mutation', async () => {
    const { handler, calls } = setup({ token: json({ error: 'invalid_grant' }, 400) });
    const response = await handler(post(valid));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'verification_failed' });
    expect(methods(calls).some(m => m.startsWith('PUT') || m.includes('logout') || m.startsWith('PATCH'))).toBe(false);
  });

  it('treats a verification outage as unavailable, not as a wrong password', async () => {
    const { handler, calls } = setup({ token: json({}, 503) });
    const response = await handler(post(valid));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'verification_unavailable' });
    expect(calls.some(c => c.method === 'PUT')).toBe(false);
  });

  it('does not change the password when the verification request throws', async () => {
    const { handler, calls } = setup({ token: new Error('network down') });
    expect((await handler(post(valid))).status).toBe(503);
    expect(calls.some(c => c.method === 'PUT')).toBe(false);
  });

  it('never retries the Auth password change after an uncertain failure', async () => {
    const { handler, calls } = setup({ put: json({}, 500) });
    const response = await handler(post(valid));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'change_unconfirmed' });
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(1);
    expect(calls.some(c => c.url.includes('/logout') || c.method === 'PATCH')).toBe(false);
  });

  it('reports a thrown password-change request as change_unconfirmed', async () => {
    const { handler, calls } = setup({ put: new Error('connection reset') });
    const response = await handler(post(valid));
    expect(await response.json()).toEqual({ code: 'change_unconfirmed' });
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(1);
    expect(calls.some(c => c.method === 'PATCH')).toBe(false);
  });

  it('keeps the flag set when session revocation fails', async () => {
    const { handler, calls } = setup({ logout: json({}, 500) });
    const response = await handler(post(valid));
    expect(await response.json()).toEqual({ code: 'revocation_unconfirmed' });
    expect(calls.some(c => c.method === 'PATCH')).toBe(false);
  });

  it('reports an unconfirmed flag clear without retrying the password change', async () => {
    const { handler, calls } = setup({ patch: json([]) });
    const response = await handler(post(valid));
    expect(await response.json()).toEqual({ code: 'completion_unconfirmed' });
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(1);
  });
});

describe('change-password Edge Function: success path', () => {
  it('changes the password with the verified session, revokes sessions, then clears the flag', async () => {
    const { handler, calls } = setup();
    const response = await handler(post(valid));
    expect(response.status).toBe(200);
    expect(methods(calls)).toEqual([
      'GET /auth/v1/user',
      'GET /rest/v1/profiles?select=id%2Cis_active%2Cmust_change_password&id=eq.' + userId,
      'POST /auth/v1/token?grant_type=password',
      'PUT /auth/v1/user',
      'POST /auth/v1/logout?scope=global',
      'PATCH /rest/v1/profiles?select=id%2Cmust_change_password&id=eq.' + userId + '&is_active=eq.true',
    ]);
  });

  it('uses the verification session token for the change and revocation, never the caller token', async () => {
    const { handler, calls } = setup();
    await handler(post(valid));
    const put = calls.find(c => c.method === 'PUT')!;
    const logout = calls.find(c => c.url.includes('/logout'))!;
    expect(put.headers.Authorization).toBe(`Bearer ${verifyToken}`);
    expect(logout.headers.Authorization).toBe(`Bearer ${verifyToken}`);
  });

  it('clears only this caller and only the flag fields, using the service role', async () => {
    const { handler, calls } = setup();
    await handler(post(valid));
    const patch = calls.find(c => c.method === 'PATCH')!;
    expect(patch.headers.Authorization).toBe('Bearer synthetic-service-key');
    const body = JSON.parse(patch.body!);
    expect(Object.keys(body).sort()).toEqual(['must_change_password', 'password_changed_at']);
    expect(body.must_change_password).toBe(false);
  });

  it('never returns the passwords or any token in the response', async () => {
    const { handler } = setup();
    const text = await (await handler(post(valid))).text();
    expect(text).toBe(JSON.stringify({ code: 'password_changed' }));
    for (const secret of [currentPassword, newPassword, verifyToken, bearer, 'synthetic-service-key']) {
      expect(text).not.toContain(secret);
    }
  });

  it('never echoes upstream bodies on failure', async () => {
    const { handler } = setup({ put: new Response('leak synthetic-verification-token ' + newPassword, { status: 500 }) });
    const text = await (await handler(post(valid))).text();
    expect(text).not.toContain(newPassword);
    expect(text).not.toContain(verifyToken);
  });
});
