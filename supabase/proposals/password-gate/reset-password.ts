// RESEARCH ONLY. Not deployed or integrated. This operation is not atomic
// across Postgres and GoTrue. Ambiguous failures deliberately leave the target
// locked, and a reviewed, tested recovery procedure is still missing. The real
// deployment also needs rate limiting, request-size limits, edge authorization
// coverage, logging redaction, onboarding and concurrent-reset review.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const response = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function claims(token: string): { sub: string; sessionId: string } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || !/^[a-zA-Z0-9_-]+$/.test(parts[1]) || parts[1].length > 8192) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const c = JSON.parse(atob(payload + '='.repeat((4 - payload.length % 4) % 4))) as { sub?: unknown; session_id?: unknown }
    if (typeof c.sub !== 'string' || !uuid.test(c.sub) || typeof c.session_id !== 'string' || !uuid.test(c.session_id)) return null
    return { sub: c.sub, sessionId: c.session_id }
  } catch { return null }
}
function temporaryPassword(): string {
  const groups = ['abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%^&*()-_=+']
  const all = groups.join('')
  const random = (n: number) => {
    const buffer = new Uint32Array(1)
    const ceiling = 0x100000000 - (0x100000000 % n)
    do { crypto.getRandomValues(buffer) } while (buffer[0] >= ceiling)
    return buffer[0] % n
  }
  const result = groups.map(group => group[random(group.length)])
  while (result.length < 20) result.push(all[random(all.length)])
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1); [result[i], result[j]] = [result[j], result[i]]
  }
  return result.join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return response(405, { code: 'method_not_allowed' })
  const base = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!base || !key) return response(503, { code: 'reset_unavailable' })
  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const jwt = claims(token)
  if (!jwt) return response(401, { code: 'authentication_required' })
  let target: string
  try {
    const body = await req.json() as { userId?: unknown }
    if (typeof body.userId !== 'string' || !uuid.test(body.userId) || body.userId === jwt.sub) return response(400, { code: 'invalid_target' })
    target = body.userId
  } catch { return response(400, { code: 'invalid_target' }) }
  const userHeaders = { apikey: key, Authorization: `Bearer ${token}` }
  const serviceHeaders = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  try {
    // Auth verifies the bearer. The database checks its live session, admitted
    // generation and active administrator role in the begin transaction.
    const callerResponse = await fetch(`${base}/auth/v1/user`, { headers: userHeaders, redirect: 'error' })
    if (!callerResponse.ok || (await callerResponse.json() as { id?: unknown }).id !== jwt.sub) return response(401, { code: 'authentication_required' })
    const operation = crypto.randomUUID()
    const password = temporaryPassword()
    const begin = await fetch(`${base}/rest/v1/rpc/prototype_begin_authorized_password_reset`, {
      method: 'POST', headers: serviceHeaders, redirect: 'error',
      body: JSON.stringify({ p_user: target, p_actor: jwt.sub, p_actor_session: jwt.sessionId, p_operation: operation }),
    })
    // A lost response may have acquired the reset lock. Do not mutate Auth or
    // automatically retry if this step is not confirmed.
    if (!begin.ok) return response(503, { code: 'reset_unconfirmed' })
    const changed = await fetch(`${base}/auth/v1/admin/users/${target}`, {
      method: 'PUT', headers: serviceHeaders, redirect: 'error', body: JSON.stringify({ password }),
    })
    if (!changed.ok || (await changed.json() as { id?: unknown }).id !== target) return response(503, { code: 'reset_unconfirmed' })
    const finish = await fetch(`${base}/rest/v1/rpc/prototype_finish_password_reset`, {
      method: 'POST', headers: serviceHeaders, redirect: 'error', body: JSON.stringify({ p_user: target, p_operation: operation }),
    })
    if (!finish.ok) return response(503, { code: 'reset_unconfirmed' })
    // No claim is made about actual session revocation. The app gate is meant
    // to reject prior sessions once wired, but no such gate is deployed yet.
    return response(200, { code: 'reset_required', temporaryPassword: password })
  } catch {
    // Do not return network errors: they can include sensitive information.
    return response(503, { code: 'reset_unconfirmed' })
  }
})
