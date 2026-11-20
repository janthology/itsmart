// RESEARCH ONLY. Not deployed or integrated; not safe to deploy as-is.
// This demonstrates admission ordering for cleared accounts and a restricted
// temporary-password session. It does NOT implement abuse/rate limiting, MFA,
// account creation, recovery operations, client integration or full Auth error handling.
// Never log request bodies, passwords, sessions, service keys or raw errors.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Parse only a token returned directly by the trusted GoTrue endpoint. Its
// authenticity and user are checked with /auth/v1/user before admission.
function claimsFromGoTrue(token: string): { sub: string; sessionId: string } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || !/^[a-zA-Z0-9_-]+$/.test(parts[1]) || parts[1].length > 8192) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(payload + '='.repeat((4 - payload.length % 4) % 4))) as { sub?: unknown; session_id?: unknown }
    if (typeof claims.sub !== 'string' || !uuid.test(claims.sub) || typeof claims.session_id !== 'string' || !uuid.test(claims.session_id)) return null
    return { sub: claims.sub, sessionId: claims.session_id }
  } catch { return null }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply(405, { code: 'method_not_allowed' })
  const base = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!base || !key) return reply(503, { code: 'login_unavailable' })
  let email: string, password: string
  try {
    const body = await req.json() as { email?: unknown; password?: unknown }
    if (typeof body.email !== 'string' || typeof body.password !== 'string') return reply(400, { code: 'invalid_input' })
    email = body.email.trim(); password = body.password
    if (!email || email.length > 320 || !password || password.length > 1024) return reply(400, { code: 'invalid_input' })
  } catch { return reply(400, { code: 'invalid_input' }) }
  const serviceHeaders = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  let sessionToken: string | null = null
  let handoffReady = false
  try {
    // Snapshot MUST precede password verification. A reset that begins at any
    // point before admission changes/blocks this generation under row lock.
    const snapshot = await fetch(`${base}/rest/v1/rpc/prototype_snapshot_login_identity`, {
      method: 'POST', headers: serviceHeaders, body: JSON.stringify({ p_email: email }), redirect: 'error',
    })
    if (!snapshot.ok) return reply(503, { code: 'login_unavailable' })
    const identities = await snapshot.json() as Array<{ user_id?: unknown; generation?: unknown; gate_phase?: unknown }>
    if (!Array.isArray(identities) || identities.length !== 1 || typeof identities[0].user_id !== 'string' ||
        !uuid.test(identities[0].user_id) || typeof identities[0].generation !== 'string' || !uuid.test(identities[0].generation) ||
        (identities[0].gate_phase !== 'cleared' && identities[0].gate_phase !== 'required')) {
      return reply(401, { code: 'login_failed' })
    }
    const identity = identities[0] as { user_id: string; generation: string; gate_phase: 'cleared' | 'required' }
    const verified = await fetch(`${base}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }), redirect: 'error',
    })
    if (!verified.ok) return reply(401, { code: 'login_failed' })
    const session = await verified.json() as { access_token?: unknown; refresh_token?: unknown; user?: { id?: unknown } }
    if (typeof session.access_token === 'string' && session.access_token) sessionToken = session.access_token
    if (!sessionToken || typeof session.refresh_token !== 'string' || !session.refresh_token) {
      return reply(503, { code: 'login_unavailable' })
    }
    const claims = claimsFromGoTrue(sessionToken)
    if (!claims || claims.sub !== identity.user_id || session.user?.id !== identity.user_id) return reply(401, { code: 'login_failed' })
    const live = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${sessionToken}` }, redirect: 'error' })
    if (!live.ok || (await live.json() as { id?: unknown }).id !== identity.user_id) return reply(401, { code: 'login_failed' })
    const operation = identity.gate_phase === 'cleared' ? 'prototype_admit_verified_session' : 'prototype_confirm_recovery_session'
    const grant = await fetch(`${base}/rest/v1/rpc/${operation}`, {
      method: 'POST', headers: serviceHeaders, redirect: 'error',
      body: JSON.stringify({ p_user: identity.user_id, p_session: claims.sessionId, p_generation: identity.generation }),
    })
    if (!grant.ok) return reply(503, { code: 'login_unavailable' })
    handoffReady = true
    // For required changes this session is NOT admitted to application data;
    // the client must independently consult the gate before showing the app.
    // A real browser integration must install tokens securely and handle expiry.
    return reply(200, { access_token: session.access_token, refresh_token: session.refresh_token, password_change_required: identity.gate_phase === 'required' })
  } catch {
    return reply(503, { code: 'login_unavailable' })
  } finally {
    // Best effort for failed or ambiguous admission. If admission committed
    // but its response was lost and logout fails, an orphan may remain admitted.
    // Never return its credentials; recovery/cleanup is still unresolved.
    if (sessionToken && !handoffReady) {
      try { await fetch(`${base}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${sessionToken}` }, redirect: 'error' }) } catch { /* remains unadmitted */ }
    }
  }
})
