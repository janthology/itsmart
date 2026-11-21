const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const VALID_ROLES = new Set(['general_user', 'support_staff', 'administrator'])

// Generate a one-time temporary password instead of using a shared default
// (the old "dostro2" was identical for every user and publicly known from
// the UI copy). Each account gets a fresh 20-character password drawn from
// a CSPRNG with at least one character per class, satisfying the app's
// password rules. It is returned to the calling administrator exactly once
// in this response; only its hash is ever stored (by GoTrue), and the
// account is flagged must_change_password for the app prompt. This flag is
// not yet a server-side access boundary. Ambiguous
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

async function readError(response: Response, fallback: string) {
  try {
    const data = await response.json() as {
      error?: string
      message?: string
      msg?: string
    }
    return data.error ?? data.message ?? data.msg ?? fallback
  } catch {
    return fallback
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

    const { email, fullName, department, role } = await req.json() as {
      email?: unknown
      fullName?: unknown
      department?: unknown
      role?: unknown
    }
    if (!email || typeof email !== 'string' || !fullName || typeof fullName !== 'string') {
      return jsonResponse(400, { error: 'email and fullName are required' })
    }

    const targetRole = role === undefined || role === null ? 'general_user' : role
    if (typeof targetRole !== 'string' || !VALID_ROLES.has(targetRole)) {
      return jsonResponse(400, { error: 'Invalid user role' })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const normalizedName = fullName.trim()
    if (!normalizedEmail || !normalizedName) {
      return jsonResponse(400, { error: 'email and fullName are required' })
    }
    const normalizedDept =
      typeof department === 'string' && department.trim().length > 0
        ? department.trim()
        : null

    const temporaryPassword = generateTemporaryPassword()

    let createResponse: Response
    try {
      createResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password: temporaryPassword,
          email_confirm: true,
          user_metadata: { full_name: normalizedName, department: normalizedDept },
        }),
      })
    } catch {
      // The request may have committed before the connection was lost.
      return jsonResponse(503, { code: 'creation_unconfirmed', error: 'User creation could not be confirmed. Check Auth and the user list before retrying.' })
    }
    if (!createResponse.ok) {
      if (createResponse.status >= 500) {
        return jsonResponse(503, { code: 'creation_unconfirmed', error: 'User creation could not be confirmed. Check Auth and the user list before retrying.' })
      }
      return jsonResponse(400, { error: await readError(createResponse, 'Failed to create user') })
    }

    let createdUser: { id?: string }
    try {
      createdUser = await createResponse.json() as { id?: string }
    } catch {
      return jsonResponse(503, { code: 'creation_unconfirmed', error: 'User creation could not be confirmed. Check Auth and the user list before retrying.' })
    }
    if (!createdUser.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(createdUser.id)) {
      return jsonResponse(503, { code: 'creation_unconfirmed', error: 'User creation could not be confirmed. Check Auth and the user list before retrying.' })
    }

    const profileUrl = new URL(`${supabaseUrl}/rest/v1/profiles`)
    profileUrl.searchParams.set('on_conflict', 'id')
    profileUrl.searchParams.set('select', 'id,role,is_active,must_change_password')
    let profileConfirmed = false
    try {
      const profileResponse = await fetch(profileUrl, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify({
          id: createdUser.id,
          full_name: normalizedName,
          department: normalizedDept,
          role: targetRole,
          is_active: true,
          must_change_password: true,
        }),
      })
      if (profileResponse.ok) {
        const profiles = await profileResponse.json() as Array<{ id?: string; role?: string; is_active?: boolean; must_change_password?: boolean }>
        profileConfirmed = Array.isArray(profiles) && profiles.length === 1 &&
          profiles[0]?.id === createdUser.id && profiles[0]?.role === targetRole &&
          profiles[0]?.is_active === true && profiles[0]?.must_change_password === true
      }
    } catch {
      // A failed response does not prove whether the profile was written.
    }

    if (!profileConfirmed) {
      let cleanupConfirmed = false
      try {
        const cleanup = await fetch(
          `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(createdUser.id)}`,
          { method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
        )
        cleanupConfirmed = cleanup.ok
      } catch {
        // The delete might have succeeded even if its response was lost.
      }
      if (!cleanupConfirmed) {
        return jsonResponse(500, {
          code: 'cleanup_unconfirmed', userId: createdUser.id,
          error: 'User setup failed and cleanup could not be confirmed. Check Auth and the profile before retrying.',
        })
      }
      return jsonResponse(500, {
        code: 'cleanup_requested', userId: createdUser.id,
        error: 'User setup failed and the new Auth account was removed. Verify Auth and the profile before retrying.',
      })
    }

    // Record the gate state so the new account can change its password through
    // the gate. The temporary password is withheld unless both steps confirm.
    // A failure leaves the account created and flagged, without a usable gate
    // state; use Reset password to recover. The Auth account is not deleted here.
    const operation = crypto.randomUUID()
    const begin = await gateRpc(supabaseUrl, serviceKey, 'password_gate_begin_reset', createdUser.id, operation)
    const finish = begin === 'ok'
      ? await gateRpc(supabaseUrl, serviceKey, 'password_gate_finish_reset', createdUser.id, operation)
      : 'unknown'
    if (finish !== 'ok') {
      return jsonResponse(503, {
        code: 'gate_unconfirmed', userId: createdUser.id,
        error: 'The account was created, but its password gate could not be confirmed. Do not share a password. Use Reset password for this account to recover.',
      })
    }

    // The temporary password is returned only here, only to the verified
    // administrator caller, and is never logged or stored in plaintext.
    return jsonResponse(200, {
      success: true,
      userId: createdUser.id,
      temporaryPassword,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonResponse(500, { error: message })
  }
})
