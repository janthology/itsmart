// Trusted password gate, Phase 3 step 3.2: the only sign-in path.
// The browser sends email and password here. The function:
//   1. Verifies the password with a GoTrue password grant (service key as apikey).
//   2. Parses session_id and sub from the returned access token, then checks the
//      same token with GoTrue /auth/v1/user. The token is trusted only after that.
//   3. Reads the profile (must be active) and the gate row, with the service role.
//   4. Admits the session in the database under the current generation:
//        cleared           -> password_gate_admit_session (full scope)
//        required/changing -> password_gate_admit_restricted_session (password change only)
//        resetting, or no gate row, or inactive -> refused
//   5. Returns tokens only after admission succeeds. Any failure after step 1 logs the
//      session out (scope local), so no unadmitted token is returned.
// The database re-checks the generation under a row lock during admission, so a reset
// that starts at any point before admission makes the admission fail.
// Not in this function, and still open: rate limiting and lockout, which GoTrue applies
// only in part. Never log or return passwords, raw Auth responses, or service keys.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_EMAIL_LENGTH = 320
const MAX_PASSWORD_LENGTH = 1024

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function serviceRoleKey() {
  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacyKey) return legacyKey
  const encodedKeys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (!encodedKeys) return ''
  try {
    const keys = JSON.parse(encodedKeys) as Record<string, string>
    return keys.default ?? Object.values(keys)[0] ?? ''
  } catch {
    return ''
  }
}

// Reads sub and session_id from a token that GoTrue has just returned. Returns null
// unless both are UUIDs. A token without session_id is refused: admission depends on it.
function claimsFromToken(token: string): { sub: string; sessionId: string } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || parts[1].length > 8192) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(payload + '='.repeat((4 - (payload.length % 4)) % 4))) as {
      sub?: unknown
      session_id?: unknown
    }
    if (typeof claims.sub !== 'string' || !UUID_RE.test(claims.sub)) return null
    if (typeof claims.session_id !== 'string' || !UUID_RE.test(claims.session_id)) return null
    return { sub: claims.sub, sessionId: claims.session_id }
  } catch {
    return null
  }
}

type Phase = 'cleared' | 'required' | 'changing' | 'resetting'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse(405, { code: 'method_not_allowed' })

  const base = Deno.env.get('SUPABASE_URL') ?? ''
  const key = serviceRoleKey()
  if (!base || !key) return jsonResponse(503, { code: 'login_unavailable' })

  let email: string
  let password: string
  try {
    const body = await req.json() as { email?: unknown; password?: unknown }
    if (typeof body.email !== 'string' || typeof body.password !== 'string') return jsonResponse(400, { code: 'invalid_input' })
    email = body.email.trim()
    password = body.password
    if (!email || email.length > MAX_EMAIL_LENGTH || !password || password.length > MAX_PASSWORD_LENGTH) {
      return jsonResponse(400, { code: 'invalid_input' })
    }
  } catch {
    return jsonResponse(400, { code: 'invalid_input' })
  }

  const serviceHeaders = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  let accessToken: string | null = null
  let admitted = false

  // Logs out the session that GoTrue issued, if it was not admitted. Best effort.
  const discardSession = async () => {
    if (!accessToken || admitted) return
    try {
      await fetch(`${base}/auth/v1/logout?scope=local`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
        redirect: 'error',
      })
    } catch {
      // The session stays unadmitted: it has no admitted row, so enforcement denies it.
    }
  }

  try {
    // 1. Verify the password. A failed grant is 'login_failed' whatever the reason.
    const grant = await fetch(`${base}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      redirect: 'error',
    })
    if (!grant.ok) {
      return jsonResponse(grant.status >= 500 ? 503 : 401, {
        code: grant.status >= 500 ? 'login_unavailable' : 'login_failed',
      })
    }
    const issued = await grant.json() as { access_token?: unknown; refresh_token?: unknown; user?: { id?: unknown } }
    if (typeof issued.access_token !== 'string' || !issued.access_token) return jsonResponse(503, { code: 'login_unavailable' })
    accessToken = issued.access_token
    if (typeof issued.refresh_token !== 'string' || !issued.refresh_token) {
      await discardSession()
      return jsonResponse(503, { code: 'login_unavailable' })
    }

    // 2. Trust the token only after checking its claims and the live user.
    const claims = claimsFromToken(accessToken)
    if (!claims || (typeof issued.user?.id === 'string' && issued.user.id !== claims.sub)) {
      await discardSession()
      return jsonResponse(401, { code: 'login_failed' })
    }
    const live = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
    })
    if (!live.ok || (await live.json() as { id?: unknown }).id !== claims.sub) {
      await discardSession()
      return jsonResponse(401, { code: 'login_failed' })
    }

    // 3. Profile and gate, read with the service role.
    const profileResponse = await fetch(
      `${base}/rest/v1/profiles?id=eq.${claims.sub}&select=is_active`,
      { headers: serviceHeaders, redirect: 'error' },
    )
    if (!profileResponse.ok) {
      await discardSession()
      return jsonResponse(503, { code: 'login_unavailable' })
    }
    const profiles = await profileResponse.json() as Array<{ is_active?: unknown }>
    if (!Array.isArray(profiles) || profiles.length !== 1) {
      await discardSession()
      return jsonResponse(403, { code: 'account_unavailable' })
    }
    // The password was already verified above, so an inactive account can say so.
    if (profiles[0].is_active !== true) {
      await discardSession()
      return jsonResponse(403, { code: 'account_unavailable' })
    }

    // Read through the service-only RPC. The table itself has no service_role privilege (Phase 1).
    const gateResponse = await fetch(`${base}/rest/v1/rpc/password_gate_broker_state`, {
      method: 'POST',
      headers: serviceHeaders,
      redirect: 'error',
      body: JSON.stringify({ p_user: claims.sub }),
    })
    if (!gateResponse.ok) {
      await discardSession()
      return jsonResponse(503, { code: 'login_unavailable' })
    }
    const gates = await gateResponse.json() as Array<{ phase?: unknown; operation_id?: unknown }>
    // A missing gate row is refused: the backfill (step 3.2a) gives every account one.
    if (!Array.isArray(gates) || gates.length !== 1 || typeof gates[0].operation_id !== 'string' || !UUID_RE.test(gates[0].operation_id)) {
      await discardSession()
      return jsonResponse(503, { code: 'login_unavailable' })
    }
    const phase = gates[0].phase as Phase
    const generation = gates[0].operation_id

    // 4. Admit under the current generation. Only these three phases are known.
    if (phase === 'resetting') {
      await discardSession()
      return jsonResponse(403, { code: 'account_unavailable' })
    }
    if (phase !== 'cleared' && phase !== 'required' && phase !== 'changing') {
      await discardSession()
      return jsonResponse(503, { code: 'login_unavailable' })
    }
    const rpc = phase === 'cleared' ? 'password_gate_admit_session' : 'password_gate_admit_restricted_session'
    const admission = await fetch(`${base}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: serviceHeaders,
      redirect: 'error',
      body: JSON.stringify({ p_user: claims.sub, p_session: claims.sessionId, p_generation: generation }),
    })
    if (!admission.ok) {
      // PostgREST returns 400 when the function raised, i.e. the generation changed or
      // the account is unavailable. Either way the session is not admitted.
      await discardSession()
      return jsonResponse(admission.status === 400 ? 403 : 503, {
        code: admission.status === 400 ? 'account_unavailable' : 'login_unavailable',
      })
    }
    admitted = true

    // 5. Only now hand the tokens to the browser.
    return jsonResponse(200, {
      access_token: issued.access_token,
      refresh_token: issued.refresh_token,
      password_change_required: phase !== 'cleared',
    })
  } catch {
    await discardSession()
    return jsonResponse(503, { code: 'login_unavailable' })
  }
})
