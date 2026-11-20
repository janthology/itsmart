import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Mocked network calls only. No actual Auth, JWT verification, password,
// database transaction, Edge gateway, MFA, rate limit, or browser session.
const actor = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const sessionId = '10000000-0000-4000-8000-000000000001';
const generation = '20000000-0000-4000-8000-000000000001';
const password = 'Synthetic-password-9!';
const refresh = 'synthetic-refresh-token';
const token = (sub = actor, sid = sessionId) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub, session_id: sid })).toString('base64url')}.signature`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Handler = (request: Request) => Promise<Response>;
type Options = { snapshot?: Response | Error; verify?: Response | Error; user?: Response | Error; grant?: Response | Error; logout?: Response | Error };
function setup(options: Options = {}) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    let result: Response | Error;
    if (url.endsWith('/prototype_snapshot_login_identity')) result = options.snapshot ?? json([{ user_id: actor, generation, gate_phase: 'cleared' }]);
    else if (url.includes('/auth/v1/token?')) result = options.verify ?? json({ access_token: token(), refresh_token: refresh, user: { id: actor } });
    else if (url.endsWith('/auth/v1/user')) result = options.user ?? json({ id: actor });
    else if (url.endsWith('/prototype_admit_verified_session') || url.endsWith('/prototype_confirm_recovery_session')) result = options.grant ?? json(null);
    else if (url.includes('/auth/v1/logout?')) result = options.logout ?? json(null);
    else throw new Error('Unexpected mocked request');
    if (result instanceof Error) throw result;
    return result;
  });
  let handler: Handler | undefined;
  const source = readFileSync(new URL('../../../../supabase/proposals/password-gate/login-broker.ts', import.meta.url), 'utf8');
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
  runInNewContext(js, { Response, Request, JSON, atob, fetch: fetchMock, Deno: { env: { get: (key: string) => key === 'SUPABASE_URL' ? 'https://synthetic.invalid' : key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'synthetic-service-key' : undefined }, serve: (fn: Handler) => { handler = fn; } } });
  if (!handler) throw new Error('No handler registered');
  return { handler, calls };
}
const request = (body: unknown = { email: 'synthetic@example.invalid', password }) => new Request('https://synthetic.invalid/function', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('login admission broker prototype (not deployed)', () => {
  it('snapshots before password verification, verifies Auth user, admits only the returned session, and returns only its tokens', async () => {
    const { handler, calls } = setup();
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ access_token: token(), refresh_token: refresh, password_change_required: false });
    expect(calls.map(c => c.url.split('/').at(-1))).toEqual(['prototype_snapshot_login_identity','token?grant_type=password','user','prototype_admit_verified_session']);
    expect(calls[3].body).toEqual({ p_user: actor, p_session: sessionId, p_generation: generation });
    expect(JSON.stringify(calls[0].body)).not.toContain(password);
    expect(JSON.stringify(calls[3].body)).not.toContain(password);
  });
  it('returns a restricted recovery session without admitting it to business data', async () => {
    const { handler, calls } = setup({ snapshot: json([{ user_id: actor, generation, gate_phase: 'required' }]) });
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ access_token: token(), refresh_token: refresh, password_change_required: true });
    expect(calls[3].url).toContain('prototype_confirm_recovery_session');
    expect(calls[3].body).toEqual({ p_user: actor, p_session: sessionId, p_generation: generation });
    expect(calls.some(c => c.url.endsWith('prototype_admit_verified_session'))).toBe(false);
  });
  it('does not accept a caller-supplied session id or generation', async () => {
    const { handler, calls } = setup();
    await handler(request({ email: 'synthetic@example.invalid', password, session_id: other, generation: other }));
    expect(calls[3].body).toEqual({ p_user: actor, p_session: sessionId, p_generation: generation });
  });
  it('does not verify or admit if the snapshot is missing or ambiguous', async () => {
    for (const identities of [[], [{ user_id: actor, generation }, { user_id: other, generation }]]) {
      const { handler, calls } = setup({ snapshot: json(identities) });
      expect((await handler(request())).status).toBe(401);
      expect(calls).toHaveLength(1);
    }
  });
  it('rejects failed password verification without admission or leaking credentials', async () => {
    const { handler, calls } = setup({ verify: json({ message: password }, 400) });
    const response = await handler(request());
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(password);
    expect(calls.some(c => c.url.endsWith('prototype_admit_verified_session'))).toBe(false);
  });
  it.each([
    ['wrong token user', { verify: json({ access_token: token(other), refresh_token: refresh, user: { id: other } }) }],
    ['missing session claim', { verify: json({ access_token: token(actor, 'bad'), refresh_token: refresh, user: { id: actor } }) }],
    ['wrong Auth user', { user: json({ id: other }) }],
    ['Auth failure', { user: json({}, 401) }],
  ])('rejects %s and tries to revoke the failed session', async (_label, options) => {
    const { handler, calls } = setup(options);
    const response = await handler(request());
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(refresh);
    expect(calls.some(c => c.url.endsWith('prototype_admit_verified_session'))).toBe(false);
    expect(calls.some(c => c.url.includes('logout?scope=local'))).toBe(true);
  });
  it.each([['explicit denial', json({}, 409)], ['lost response', new Error('synthetic error')]])('does not return a session after %s during admission', async (_label, grant) => {
    const { handler, calls } = setup({ grant });
    const response = await handler(request());
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toContain(refresh);
    expect(body).not.toContain(password);
    expect(calls.some(c => c.url.includes('logout?scope=local'))).toBe(true);
  });
});
