const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Generate a one-time temporary password instead of using a shared default
// (the old "dostro2" was identical for every user and publicly known from
// the UI copy). Each reset gets a fresh 20-character password drawn from a
// CSPRNG with at least one character per class, satisfying the app's
// password rules. It is returned to the calling administrator exactly once
// in this response; only its hash is ever stored (by GoTrue), and the
// account is flagged for the app password-change prompt. The flag is not
// yet a trusted server-side access boundary. Ambiguous
// characters (0/O, 1/l/I) are excluded so it can be relayed verbally.
function generateTemporaryPassword(length = 20): string {
  const sets = [
    'abcdefghijkmnpqrstuvwxyz', // lowercase, no l/o
    'ABCDEFGHJKLMNPQRSTUVWXYZ', // uppercase, no I/O
    '23456789', // digits, no 0/1
    '!@#$%^&*()-_=+',
  ]
  const all = sets.join('')
  const randBelow = (n: number) => {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return buf[0] % n
  }
  const chars = sets.map((s) => s[randBelow(s.length)])
  while (chars.length < length) chars.push(all[randBelow(all.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randBelow(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

async function requireActiveAdministrator(
  supabaseUrl: string,
  serviceKey: string,
  token: string,
) {
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${token}`,
    },
  })
  if (!userResponse.ok) return null

  const caller = await userResponse.json() as { id?: string }
  if (!caller.id) return null

  const profileUrl = new URL(`${supabaseUrl}/rest/v1/profiles`)
  profileUrl.searchParams.set('select', 'role,is_active')
  profileUrl.searchParams.set('id', `eq.${caller.id}`)

  const profileResponse = await fetch(profileUrl, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  })
  if (!profileResponse.ok) return null

  const profiles = await profileResponse.json() as Array<{
    role?: string
    is_active?: boolean
  }>
  const profile = profiles[0]
  return profile?.role === 'administrator' && profile.is_active === true
    ? caller
    : null
}

// Gate RPC outcome. 'refused' is returned only for HTTP 400, which PostgREST
// uses when the database function raised an exception: nothing was changed.
// Any other failure is 'unknown' and must be treated as possibly applied.
type GateOutcome = 'ok' | 'refused' | 'unknown'

async function gateRpc(
  supabaseUrl: string,
  serviceKey: string,
  name: 'password_gate_begin_reset' | 'password_gate_finish_reset',
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
  // Browser preflight requests carry no credentials, so answer them before
  // doing any configuration, authentication, or dependency work.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = serviceRoleKey()
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse(500, { error: 'Supabase server configuration is missing' })
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (!token) return jsonResponse(401, { error: 'Missing bearer token' })

    const caller = await requireActiveAdministrator(supabaseUrl, serviceKey, token)
    if (!caller) {
      return jsonResponse(403, {
        error: 'Forbidden: active administrator role required',
      })
    }

    const { userId } = await req.json() as { userId?: unknown }
    if (!userId || typeof userId !== 'string' || !UUID_RE.test(userId)) {
      return jsonResponse(400, { error: 'Valid userId UUID is required' })
    }

    // Resetting one's own Auth password can invalidate the administrator's
    // session before the one-time password is delivered. Use the self-service
    // password-change flow instead.
    if (userId === caller.id) {
      return jsonResponse(400, { code: 'self_reset_forbidden', error: 'Use Change Password for your own account.' })
    }

    // Set and verify the profile flag before the gate lock and the Auth change.
    // A failure here leaves no lock, and no Auth change has happened.
    const profileUrl = new URL(`${supabaseUrl}/rest/v1/profiles`)
    profileUrl.searchParams.set('id', `eq.${userId}`)
    profileUrl.searchParams.set('select', 'id,must_change_password')
    const setProfileFlag = async (): Promise<boolean> => {
      try {
        const profileResponse = await fetch(profileUrl, {
          method: 'PATCH',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify({ must_change_password: true }),
        })
        if (!profileResponse.ok) return false
        const profiles = await profileResponse.json() as Array<{ id?: string; must_change_password?: boolean }>
        return Array.isArray(profiles) && profiles.length === 1 && profiles[0]?.id === userId && profiles[0]?.must_change_password === true
      } catch {
        // The write may have committed despite a lost response.
        return false
      }
    }
    if (!await setProfileFlag()) {
      return jsonResponse(503, { code: 'profile_unconfirmed', error: 'Account flag could not be confirmed. Password reset was not attempted; check the profile before retrying.' })
    }

    // Take the gate lock. A refused lock means another operation is already in
    // progress for this account, so no Auth change is attempted.
    const operation = crypto.randomUUID()
    const begin = await gateRpc(supabaseUrl, serviceKey, 'password_gate_begin_reset', userId, operation)
    if (begin === 'unknown') {
      return jsonResponse(503, { code: 'reset_unconfirmed', error: 'Password reset could not be confirmed. The account may now be locked for password operations. Do not retry; contact the recovery owner.' })
    }
    if (begin === 'refused') {
      return jsonResponse(409, { code: 'reset_unavailable', error: 'Password reset is not available for this account right now. Nothing was changed.' })
    }

    const temporaryPassword = generateTemporaryPassword()
    let resetResponse: Response
    try {
      resetResponse = await fetch(
        `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
        {
          method: 'PUT',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ password: temporaryPassword }),
        },
      )
    } catch {
      // Auth might have committed despite a lost response. Never tell the
      // caller the old password is still valid or retry the change silently.
      return jsonResponse(503, { code: 'reset_unconfirmed', error: 'Password reset could not be confirmed. The password may have changed and the account is flagged; check the account before retrying.' })
    }
    if (!resetResponse.ok) {
      return jsonResponse(503, { code: 'reset_unconfirmed', error: 'Password reset could not be confirmed. The password may have changed and the account is flagged; check the account before retrying.' })
    }

    // Record the completed reset. A failure after the Auth change must never
    // discard the new password, so the response still carries it with
    // gateConfirmed false. The account then stays locked until recovery.
    const finish = await gateRpc(supabaseUrl, serviceKey, 'password_gate_finish_reset', userId, operation)
    const gateConfirmed = finish === 'ok'

    // The user could change their profile during the Auth request. Attempt to
    // flag it again. A failed response after Auth success must never discard
    // the new password: return it with an explicit recovery warning instead.
    const profileFlag = await setProfileFlag() ? 'confirmed' : 'unconfirmed'

    // Do not claim that an undocumented /admin/users/{id}/sessions DELETE
    // revoked sessions. Existing access tokens can remain valid until expiry;
    // real session behavior must be verified on a compatible Supabase stack.
    // Only the verified administrator receives the one-time password.
    return jsonResponse(200, { success: true, temporaryPassword, profileFlag, gateConfirmed, sessionRevocation: 'unverified' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonResponse(500, { error: message })
  }
})
