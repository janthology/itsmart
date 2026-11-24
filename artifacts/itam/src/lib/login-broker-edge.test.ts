import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

// Runs the real login-broker Edge Function source with every GoTrue and REST call
// mocked. No request leaves the test process.
type Handler = (request: Request) => Promise<Response>

const userId = '00000000-0000-4000-8000-000000000011'
const sessionId = '60000000-0000-4000-8000-0000000000aa'
const generation = '50000000-0000-4000-8000-0000000000bb'
const email = 'synthetic@example.test'
const password = 'Synthetic-Pass-1!'

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
function tokenFor(sub: string, sid: string | null): string {
  const claims: Record<string, unknown> = { sub, role: 'authenticated' }
  if (sid !== null) claims.session_id = sid
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.synthetic-signature`
}

interface Scenario {
  grant?: Response | Error
  accessToken?: string
  refreshToken?: string | null
  liveUserId?: string
  profile?: unknown
  gate?: unknown
  admit?: Response | Error
  logout?: Response | Error
}

interface Calls { urls: string[]; bodies: Record<string, unknown>[]; logouts: number }

function load(scenario: Scenario): { handler: Handler; calls: Calls } {
  const calls: Calls = { urls: [], bodies: [], logouts: 0 }
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
  const fetchMock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    calls.urls.push(url)
    if (init?.body) calls.bodies.push(JSON.parse(String(init.body)))
    if (url.includes('/auth/v1/token?grant_type=password')) {
      if (scenario.grant instanceof Error) throw scenario.grant
      if (scenario.grant) return scenario.grant
      const access = scenario.accessToken ?? tokenFor(userId, sessionId)
      const refresh = scenario.refreshToken === undefined ? 'synthetic-refresh' : scenario.refreshToken
      return json({ access_token: access, refresh_token: refresh, user: { id: userId } })
    }
    if (url.endsWith('/auth/v1/user')) return json({ id: scenario.liveUserId ?? userId })
    if (url.includes('/auth/v1/logout')) {
      calls.logouts++
      if (scenario.logout instanceof Error) throw scenario.logout
      return scenario.logout ?? new Response(null, { status: 204 })
    }
    if (url.includes('/rest/v1/profiles')) return json(scenario.profile ?? [{ is_active: true }])
    if (url.includes('/rest/v1/password_gate_state')) return json(scenario.gate ?? [{ phase: 'cleared', operation_id: generation }])
    if (url.includes('/rest/v1/rpc/')) {
      if (scenario.admit instanceof Error) throw scenario.admit
      return scenario.admit ?? new Response(null, { status: 204 })
    }
    throw new Error(`Unexpected request in test: ${url}`)
  }

  let handler: Handler | undefined
  const source = readFileSync(new URL('../../../../supabase/functions/login-broker/index.ts', import.meta.url), 'utf8')
  const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const env: Record<string, string> = { SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' }
  runInNewContext(script, {
    Deno: { serve: (fn: Handler) => { handler = fn }, env: { get: (key: string) => env[key] } },
    fetch: fetchMock, Request, Response, URL, JSON, Date, console, crypto: webcrypto, atob, btoa, Buffer, Error,
  })
  if (!handler) throw new Error('Function did not register a handler')
  return { handler, calls }
}

const post = (body: unknown) => new Request('https://synthetic.invalid/login-broker', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})
const creds = { email, password }
const rpcCalls = (calls: Calls) => calls.urls.filter(u => u.includes('/rest/v1/rpc/')).map(u => u.split('/rpc/')[1])

describe('login-broker: request handling', () => {
  it('answers OPTIONS and rejects other methods', async () => {
    const { handler } = load({})
    expect((await handler(new Request('https://x.invalid', { method: 'OPTIONS' }))).status).toBe(204)
    expect((await handler(new Request('https://x.invalid', { method: 'GET' }))).status).toBe(405)
  })

  it('rejects malformed or oversized input before any network call', async () => {
    for (const body of ['not json', { email: 1, password: 'x' }, { email: '', password: 'x' }, { email, password: 'x'.repeat(1025) }]) {
      const { handler, calls } = load({})
      const response = await handler(post(body))
      expect(response.status).toBe(400)
      expect(calls.urls.length).toBe(0)
    }
  })
})

describe('login-broker: password and token checks', () => {
  it('returns login_failed for a rejected password, without a session', async () => {
    const { handler, calls } = load({ grant: new Response('{}', { status: 400 }) })
    const response = await handler(post(creds))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'login_failed' })
    expect(rpcCalls(calls)).toEqual([])
  })

  it('returns login_unavailable when GoTrue fails with a server error', async () => {
    const { handler } = load({ grant: new Response('{}', { status: 500 }) })
    expect((await handler(post(creds))).status).toBe(503)
  })

  it('refuses a token with no session_id claim and logs that session out', async () => {
    const { handler, calls } = load({ accessToken: tokenFor(userId, null) })
    const response = await handler(post(creds))
    expect(response.status).toBe(401)
    expect(calls.logouts).toBe(1)
    expect(rpcCalls(calls)).toEqual([])
  })

  it('refuses when the live user does not match the token subject', async () => {
    const { handler, calls } = load({ liveUserId: '00000000-0000-4000-8000-0000000000cc' })
    expect((await handler(post(creds))).status).toBe(401)
    expect(calls.logouts).toBe(1)
    expect(rpcCalls(calls)).toEqual([])
  })
})

describe('login-broker: account state and admission', () => {
  it('admits a cleared account with the full-scope admission under its generation', async () => {
    const { handler, calls } = load({})
    const response = await handler(post(creds))
    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body.password_change_required).toBe(false)
    expect(body.access_token).toBeTypeOf('string')
    expect(body.refresh_token).toBe('synthetic-refresh')
    expect(rpcCalls(calls)).toEqual(['password_gate_admit_session'])
    expect(calls.bodies.at(-1)).toEqual({ p_user: userId, p_session: sessionId, p_generation: generation })
    expect(calls.logouts).toBe(0)
  })

  it('admits a required account with the restricted function and says a change is required', async () => {
    const { handler, calls } = load({ gate: [{ phase: 'required', operation_id: generation }] })
    const response = await handler(post(creds))
    expect(response.status).toBe(200)
    expect(((await response.json()) as Record<string, unknown>).password_change_required).toBe(true)
    expect(rpcCalls(calls)).toEqual(['password_gate_admit_restricted_session'])
  })

  it('admits a changing account with the restricted function', async () => {
    const { handler, calls } = load({ gate: [{ phase: 'changing', operation_id: generation }] })
    expect((await handler(post(creds))).status).toBe(200)
    expect(rpcCalls(calls)).toEqual(['password_gate_admit_restricted_session'])
  })

  it('refuses a resetting account with 403, logs the session out and never admits it', async () => {
    const { handler, calls } = load({ gate: [{ phase: 'resetting', operation_id: generation }] })
    const response = await handler(post(creds))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ code: 'account_unavailable' })
    expect(calls.logouts).toBe(1)
    expect(rpcCalls(calls)).toEqual([])
  })

  it('refuses an account with no gate row (the backfill should have created one)', async () => {
    const { handler, calls } = load({ gate: [] })
    expect((await handler(post(creds))).status).toBe(503)
    expect(calls.logouts).toBe(1)
    expect(rpcCalls(calls)).toEqual([])
  })

  it('refuses an inactive profile with account_unavailable (password already verified) and logs out', async () => {
    const { handler, calls } = load({ profile: [{ is_active: false }] })
    const response = await handler(post(creds))
    expect(response.status).toBe(403)
    expect(((await response.json()) as { code?: string }).code).toBe('account_unavailable')
    expect(calls.logouts).toBe(1)
    expect(rpcCalls(calls)).toEqual([])
  })

  it('returns no tokens when admission is refused because the generation changed', async () => {
    const { handler, calls } = load({ admit: new Response('{"message":"Password generation changed"}', { status: 400 }) })
    const response = await handler(post(creds))
    expect(response.status).toBe(403)
    const body = await response.json() as Record<string, unknown>
    expect(body.access_token).toBeUndefined()
    expect(body.refresh_token).toBeUndefined()
    expect(calls.logouts).toBe(1)
  })

  it('returns no tokens when admission fails with a server error', async () => {
    const { handler, calls } = load({ admit: new Response('{}', { status: 503 }) })
    const response = await handler(post(creds))
    expect(response.status).toBe(503)
    expect(((await response.json()) as Record<string, unknown>).access_token).toBeUndefined()
    expect(calls.logouts).toBe(1)
  })

  it('returns no tokens when the admission request itself throws', async () => {
    const { handler, calls } = load({ admit: new Error('network down') })
    const response = await handler(post(creds))
    expect(response.status).toBe(503)
    expect(((await response.json()) as Record<string, unknown>).access_token).toBeUndefined()
    expect(calls.logouts).toBe(1)
  })

  it('never returns the service key or the password in any response', async () => {
    const { handler } = load({})
    const text = await (await handler(post(creds))).text()
    expect(text).not.toContain('synthetic-service-key')
    expect(text).not.toContain(password)
  })
})
