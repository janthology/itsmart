// Server-side self-service password change. The browser never writes the
// must_change_password flag. Order of operations (fail closed):
//   1. Resolve the caller from their bearer token (GoTrue /auth/v1/user).
//   2. Require an active profile (service role read).
//   3. Verify the CURRENT password with a fresh GoTrue password grant. No
//      mutation has happened yet, so a failure here is safe to report.
//   4. Change the password using the verified session's token.
//   5. Revoke every session (global logout) so pre-change tokens are dropped.
//   6. Clear the flag with the service role.
// A failure after step 4 never retries the Auth mutation and never returns the
// password or any token. If step 5 or 6 fails, the flag stays set; the next
// sign-in is forced through this flow again. This function is not a complete
// trusted gate: already-issued access JWTs remain valid until expiry, and the
// database does not yet refuse business data to flagged sessions.
// Never log or return passwords, tokens, or raw Auth responses.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
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

// Mirrors the app's password rules so the server never trusts the client check.
function newPasswordRejection(currentPassword: string, newPassword: string): string | null {
  if (!currentPassword || currentPassword.length > MAX_PASSWORD_LENGTH) return 'invalid_input'
  if (newPassword.length < 8 || newPassword.length > MAX_PASSWORD_LENGTH) return 'weak_password'
  if (!/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) return 'weak_password'
  if (newPassword.toLowerCase() === 'dostro2') return 'default_password'
  if (newPassword === currentPassword) return 'same_password'
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { code: 'method_not_allowed' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = serviceRoleKey()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(500, { code: 'configuration_error' })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) {
    return jsonResponse(401, { code: 'authentication_required' })
  }

  let currentPassword: string
  let newPassword: string
  try {
    const body = await req.json() as { currentPassword?: unknown; newPassword?: unknown }
    if (typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
      return jsonResponse(400, { code: 'invalid_input' })
    }
    currentPassword = body.currentPassword
    newPassword = body.newPassword
  } catch {
    return jsonResponse(400, { code: 'invalid_input' })
  }
  const rejection = newPasswordRejection(currentPassword, newPassword)
  if (rejection) {
    return jsonResponse(400, { code: rejection })
  }

  const serviceHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  }
  let mutationStarted = false

  try {
    // 1. Resolve the caller from their own token.
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
    })
    if (!userResponse.ok) {
      return jsonResponse(401, { code: 'authentication_required' })
    }
    const caller = await userResponse.json() as { id?: unknown; email?: unknown }
    if (typeof caller.id !== 'string' || !UUID_RE.test(caller.id) || typeof caller.email !== 'string' || !caller.email) {
      return jsonResponse(403, { code: 'unsupported_account' })
    }
    const callerId = caller.id

    // 2. The account must be active.
    const profileUrl = new URL(`${supabaseUrl}/rest/v1/profiles`)
    profileUrl.searchParams.set('select', 'id,is_active,must_change_password')
    profileUrl.searchParams.set('id', `eq.${callerId}`)
    const profileResponse = await fetch(profileUrl, { headers: serviceHeaders })
    if (!profileResponse.ok) {
      return jsonResponse(503, { code: 'account_unavailable' })
    }
    const profiles = await profileResponse.json() as Array<{ id?: unknown; is_active?: unknown }>
    if (!Array.isArray(profiles) || profiles.length !== 1 || profiles[0]?.id !== callerId || profiles[0]?.is_active !== true) {
      return jsonResponse(403, { code: 'account_unavailable' })
    }

    // 3. Verify the current password. No Auth mutation has happened yet.
    let verifyResponse: Response
    try {
      verifyResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: caller.email, password: currentPassword }),
      })
    } catch {
      return jsonResponse(503, { code: 'verification_unavailable' })
    }
    if (!verifyResponse.ok) {
      return verifyResponse.status === 400 || verifyResponse.status === 401
        ? jsonResponse(400, { code: 'verification_failed' })
        : jsonResponse(503, { code: 'verification_unavailable' })
    }
    const verification = await verifyResponse.json() as { access_token?: unknown; user?: { id?: unknown } }
    if (typeof verification.access_token !== 'string' || !verification.access_token || verification.user?.id !== callerId) {
      return jsonResponse(503, { code: 'verification_unavailable' })
    }
    const sessionHeaders = { apikey: serviceKey, Authorization: `Bearer ${verification.access_token}` }

    // 4. Change the password. Never retried automatically after this point.
    mutationStarted = true
    const changeResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: { ...sessionHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    })
    if (!changeResponse.ok) {
      return jsonResponse(503, { code: 'change_unconfirmed' })
    }
    const changed = await changeResponse.json() as { id?: unknown }
    if (changed.id !== callerId) {
      return jsonResponse(503, { code: 'change_unconfirmed' })
    }

    // 5. Revoke every session, including the verification session created above.
    const revokeResponse = await fetch(`${supabaseUrl}/auth/v1/logout?scope=global`, {
      method: 'POST',
      headers: sessionHeaders,
    })
    if (!revokeResponse.ok) {
      return jsonResponse(503, { code: 'revocation_unconfirmed' })
    }

    // 6. Clear the flag. Only an active account matches this filter.
    const clearUrl = new URL(`${supabaseUrl}/rest/v1/profiles`)
    clearUrl.searchParams.set('select', 'id,must_change_password')
    clearUrl.searchParams.set('id', `eq.${callerId}`)
    clearUrl.searchParams.set('is_active', 'eq.true')
    const clearResponse = await fetch(clearUrl, {
      method: 'PATCH',
      headers: { ...serviceHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({ must_change_password: false, password_changed_at: new Date().toISOString() }),
    })
    if (!clearResponse.ok) {
      return jsonResponse(503, { code: 'completion_unconfirmed' })
    }
    const cleared = await clearResponse.json() as Array<{ id?: unknown; must_change_password?: unknown }>
    if (!Array.isArray(cleared) || cleared.length !== 1 || cleared[0]?.id !== callerId || cleared[0]?.must_change_password !== false) {
      return jsonResponse(503, { code: 'completion_unconfirmed' })
    }

    return jsonResponse(200, { code: 'password_changed' })
  } catch {
    // Never echo raw errors: they may contain secrets.
    return jsonResponse(503, { code: mutationStarted ? 'change_unconfirmed' : 'request_unconfirmed' })
  }
})
