import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

// Mocked-only prototype test, no GoTrue, PostgREST or real passwords/tokens.
const actor = '00000000-0000-4000-8000-000000000001';
const wrong = '00000000-0000-4000-8000-000000000002';
const fakeOld = 'Synthetic-old-9!';
const fakeNew = 'Synthetic-new-8!';
const fakeJwt = 'synthetic-user-token';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
type Handler = (request: Request) => Promise<Response>;
const request = (currentPassword: string = fakeOld, newPassword: string = fakeNew, withToken = true) => new Request('https://synthetic.invalid/function', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(withToken ? { authorization: `Bearer ${fakeJwt}` } : {}) },
  body: JSON.stringify({ currentPassword, newPassword }),
});
function setup(options: { state?: string; begin?: Response | Error; verification?: Response | Error; update?: Response | Error; revoke?: Response | Error; finish?: Response | Error; cancel?: Response | Error } = {}) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    let result: Response | Error;
    if (url.endsWith('/auth/v1/user') && method === 'GET') result = json({ id: actor, email: 'synthetic@example.invalid' });
    else if (url.endsWith('/prototype_password_gate_status')) result = json(options.state ?? 'required');
    else if (url.endsWith('/prototype_begin_password_change')) result = options.begin ?? json(null);
    else if (url.endsWith('/prototype_cancel_unattempted_change')) result = options.cancel ?? json(null);
    else if (url.includes('/auth/v1/token?')) result = options.verification ?? json({ user: { id: actor }, access_token: 'synthetic-reverified-token' });
    else if (url.endsWith('/auth/v1/user') && method === 'PUT') result = options.update ?? json({ id: actor });
    else if (url.endsWith('/auth/v1/logout?scope=global')) result = options.revoke ?? new Response(null, { status: 204 });
    else if (url.endsWith('/prototype_finish_password_change')) result = options.finish ?? json(null);
    else throw new Error('unexpected request');
    if (result instanceof Error) throw result;
    return result;
  });
  const source = readFileSync(new URL('../../../../supabase/proposals/password-gate/change-password.ts', import.meta.url), 'utf8');
  const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  let handler: Handler | undefined;
  runInNewContext(script, { Deno: { serve: (fn: Handler) => { handler = fn; }, env: { get: (key: string) => ({ SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' } as Record<string, string>)[key] } }, crypto: webcrypto, fetch: mock, Request, Response, console });
  return { handler: handler!, calls };
}

describe('password-change Edge proposal (mocked only)', () => {
  it('requires authentication and rejects the same current/new password before fetching', async () => {
    const { handler, calls } = setup();
    expect((await handler(request(fakeOld, fakeNew, false))).status).toBe(401);
    expect((await handler(request(fakeOld, fakeOld))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('checks gate/session, serializes, verifies current password, updates, revokes, then clears', async () => {
    const { handler, calls } = setup();
    const response = await handler(request());
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({ code: 'password_changed' });
    for (const secret of [fakeOld, fakeNew, fakeJwt, 'synthetic-service-key', 'synthetic-reverified-token']) expect(body).not.toContain(secret);
    expect(calls.map(c => c.url.split('/').pop())).toEqual(['user','prototype_password_gate_status','prototype_begin_password_change','token?grant_type=password','user','logout?scope=global','prototype_finish_password_change']);
    expect(calls[3].body).toMatchObject({ password: fakeOld });
    expect(calls[4].body).toEqual({ password: fakeNew });
    expect(calls[2].body).toEqual(calls[6].body);
  });
  it.each(['invalid_session','changing','uninitialized','cleared','reauthenticate'])('rejects gate state %s before any mutation', async state => {
    const { handler, calls } = setup({ state });
    expect((await handler(request())).status).toBe(403);
    expect(calls).toHaveLength(2);
  });
  it('never attempts Auth mutation if acquiring the operation is unconfirmed', async () => {
    const { handler, calls } = setup({ begin: new Error('synthetic network loss') });
    expect(await (await handler(request())).json()).toEqual({ code: 'operation_unconfirmed' });
    expect(calls.some(c => c.method === 'PUT')).toBe(false);
  });
  it.each([
    ['wrong password', () => json({}, 400)],
    ['wrong account', () => json({ access_token: 'synthetic-token', user: { id: wrong } })],
    ['network failure', () => new Error('synthetic network loss')],
  ])('releases the operation before any mutation on %s', async (_label, response) => {
    const { handler, calls } = setup({ verification: response() });
    const result = await handler(request());
    expect(result.status).not.toBe(200);
    expect(calls.filter(c => c.url.endsWith('/prototype_cancel_unattempted_change'))).toHaveLength(1);
    expect(calls.some(c => c.method === 'PUT')).toBe(false);
  });
  it.each([
    ['Auth update', { update: new Error('network loss') }, 'change_unconfirmed'],
    ['Auth identity mismatch', { update: json({ id: wrong }) }, 'change_unconfirmed'],
    ['session revocation', { revoke: new Error('network loss') }, 'revocation_unconfirmed'],
    ['completion', { finish: new Error('network loss') }, 'completion_unconfirmed'],
  ])('fails closed after an ambiguous %s', async (_label, options, expected) => {
    const { handler, calls } = setup(options);
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: expected });
    expect(calls.some(c => c.url.endsWith('/prototype_cancel_unattempted_change'))).toBe(false);
    if (expected !== 'completion_unconfirmed') expect(calls.some(c => c.url.endsWith('/prototype_finish_password_change'))).toBe(false);
  });
});
