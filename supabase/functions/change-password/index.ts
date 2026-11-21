// Server-side self-service password change. The browser never writes the
// must_change_password flag. Order of operations (fail closed):
//   1. Resolve the caller from their bearer token (GoTrue /auth/v1/user).
//   2. Require an active profile (service role read).
//   3. Gate: take the change lock with password_gate_begin_change (Phase 2).
//      A flagged account with no lock available is refused here. An unflagged
//      account with no lock continues on the existing path, without gate state.
//   4. Verify the CURRENT password with a fresh GoTrue password grant. No
//      mutation has happened yet, so a failure here releases the lock.
//   5. Change the password using the verified session's token.
//   6. Revoke every session (global logout) so pre-change tokens are dropped.
//   7. Gate: mark the operation complete (password_gate_finish_change).
//   8. Clear the flag with the service role, last.
// A failure after step 5 never retries the Auth mutation and never returns the
// password or any token. The gate lock is then held (phase 'changing'), and
// the flag stays set. This needs a Phase 4 recovery procedure. This function
// is not a complete trusted gate: already-issued access JWTs remain valid
// until expiry, and the database does not yet refuse business data to flagged
// sessions (Phase 3).
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

// Gate RPC outcome. 'refused' is returned only for HTTP 400, which PostgREST
// uses when the database function raised an exception: nothing was changed.
// Any other failure (network error, other status) is 'unknown' and must be
// treated as possibly applied.
type GateOutcome = 'ok' | 'refused' | 'unknown'

async function gateRpc(
  supabaseUrl: string,
  serviceKey: string,
  name: 'password_gate_begin_change' | 'password_gate_cancel_unattempted_change' | 'password_gate_finish_change',
  userId: string,
  operation: string,
): Promise<GateOutcome> {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user: userId, p_operation: operation }),
    })
    if (response.ok) return 'ok'
    return response.status === 400 ? 'refused' : 'unknown'
  } catch {
    return 'unknown'
  }
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
  // The gate lock is held only after password_gate_begin_change succeeds.
  let gated = false
  let operation = ''
  let callerIdForGate = ''
  // Releases the lock only before any Auth password mutation. Returns false if
  // the lock could not be released, so the caller must report it unconfirmed.
  const releaseBeforeMutation = async (): Promise<boolean> => {
    if (!gated) return true
    return await gateRpc(supabaseUrl, serviceKey, 'password_gate_cancel_unattempted_change', callerIdForGate, operation) === 'ok'
  }

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
    callerIdForGate = callerId

    // 2. The account must be active.
    const profileUrl = new URL(`${supabaseUrl}/rest/v1/profiles`)
    profileUrl.searchParams.set('select', 'id,is_active,must_change_password')
    profileUrl.searchParams.set('id', `eq.${callerId}`)
    const profileResponse = await fetch(profileUrl, { headers: serviceHeaders })
    if (!profileResponse.ok) {
      return jsonResponse(503, { code: 'account_unavailable' })
    }
    const profiles = await profileResponse.json() as Array<{ id?: unknown; is_active?: unknown; must_change_password?: unknown }>
    if (!Array.isArray(profiles) || profiles.length !== 1 || profiles[0]?.id !== callerId || profiles[0]?.is_active !== true) {
      return jsonResponse(403, { code: 'account_unavailable' })
    }
    const flagged = profiles[0]?.must_change_password === true

    // 3. Take the gate lock. It is taken before any credential check, so a
    // concurrent change or reset cannot run alongside this one.
    operation = crypto.randomUUID()
    const begin = await gateRpc(supabaseUrl, serviceKey, 'password_gate_begin_change', callerId, operation)
    if (begin === 'ok') {
      gated = true
    } else if (begin === 'unknown') {
      // The lock may have been taken. Nothing has changed, so stop here.
      return jsonResponse(503, { code: 'operation_unconfirmed' })
    } else if (flagged) {
      // A flagged account may change its password only through the gate.
      return jsonResponse(403, { code: 'change_unavailable' })
    }

    // 4. Verify the current password. No Auth mutation has happened yet.
    let verification: { access_token?: unknown; user?: { id?: unknown } }
    try {
      const verifyResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: caller.email, password: currentPassword }),
      })
      if (!verifyResponse.ok) {
        const wrongPassword = verifyResponse.status === 400 || verifyResponse.status === 401
        const code = wrongPassword ? 'verification_failed' : 'verification_unavailable'
        if (!await releaseBeforeMutation()) return jsonResponse(503, { code: 'operation_unconfirmed' })
        return jsonResponse(wrongPassword ? 400 : 503, { code })
      }
      verification = await verifyResponse.json() as typeof verification
    } catch {
      if (!await releaseBeforeMutation()) return jsonResponse(503, { code: 'operation_unconfirmed' })
      return jsonResponse(503, { code: 'verification_unavailable' })
    }
    if (typeof verification.access_token !== 'string' || !verification.access_token || verification.user?.id !== callerId) {
      if (!await releaseBeforeMutation()) return jsonResponse(503, { code: 'operation_unconfirmed' })
      return jsonResponse(503, { code: 'verification_unavailable' })
    }
    const sessionHeaders = { apikey: serviceKey, Authorization: `Bearer ${verification.access_token}` }

    // 5. Change the password. Never retried automatically after this point.
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

    // 6. Revoke every session, including the verification session created above.
    const revokeResponse = await fetch(`${supabaseUrl}/auth/v1/logout?scope=global`, {
      method: 'POST',
      headers: sessionHeaders,
    })
    if (!revokeResponse.ok) {
      return jsonResponse(503, { code: 'revocation_unconfirmed' })
    }

    // 7. Mark the gate operation complete. A failure leaves the lock held.
    if (gated && await gateRpc(supabaseUrl, serviceKey, 'password_gate_finish_change', callerId, operation) !== 'ok') {
      return jsonResponse(503, { code: 'completion_unconfirmed' })
    }

    // 8. Clear the flag last. Only an active account matches this filter.
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
    if (!mutationStarted && gated) {
      // Still before any Auth mutation: release the lock if possible.
      await releaseBeforeMutation()
    }
    return jsonResponse(503, { code: mutationStarted ? 'change_unconfirmed' : 'request_unconfirmed' })
  }
})
