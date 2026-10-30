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
// account is flagged must_change_password so it cannot be kept. Ambiguous
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
    const normalizedDept =
      typeof department === 'string' && department.trim().length > 0
        ? department.trim()
        : null

    const temporaryPassword = generateTemporaryPassword()

    const createResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
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
        user_metadata: {
          full_name: normalizedName,
          department: normalizedDept,
        },
      }),
    })
    if (!createResponse.ok) {
      return jsonResponse(400, {
        error: await readError(createResponse, 'Failed to create user'),
      })
    }

    const createdUser = await createResponse.json() as { id?: string }
    if (!createdUser.id) {
      return jsonResponse(500, { error: 'Auth user was created without an ID' })
    }

    const profileUrl = new URL(`${supabaseUrl}/rest/v1/profiles`)
    profileUrl.searchParams.set('on_conflict', 'id')

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

    if (!profileResponse.ok) {
      const profileError = await readError(
        profileResponse,
        'Failed to create user profile',
      )

      // Avoid leaving an orphan auth account if its profile cannot be saved.
      await fetch(
        `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(createdUser.id)}`,
        {
          method: 'DELETE',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        },
      ).catch(() => undefined)

      return jsonResponse(500, { error: profileError })
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
