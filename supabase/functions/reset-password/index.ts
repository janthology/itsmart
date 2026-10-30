const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

    const { userId } = await req.json() as { userId?: unknown }
    if (!userId || typeof userId !== 'string' || !UUID_RE.test(userId)) {
      return jsonResponse(400, { error: 'Valid userId UUID is required' })
    }

    const resetResponse = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: 'PUT',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: 'dostro2' }),
      },
    )
    if (!resetResponse.ok) {
      return jsonResponse(400, {
        error: await readError(resetResponse, 'Failed to reset password'),
      })
    }

    const profileUrl = new URL(`${supabaseUrl}/rest/v1/profiles`)
    profileUrl.searchParams.set('id', `eq.${userId}`)

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
    if (!profileResponse.ok) {
      return jsonResponse(500, {
        error: await readError(
          profileResponse,
          'Password reset, but failed to flag the account for a password change',
        ),
      })
    }

    const updatedProfiles = await profileResponse.json() as unknown[]
    if (updatedProfiles.length !== 1) {
      return jsonResponse(404, { error: 'User profile not found' })
    }

    // Revoke the target's existing sessions so the old password's sessions
    // cannot keep working after the reset. Skipped when an admin resets
    // their own password (it would sign them out mid-task). Best-effort:
    // a failure here must not fail the reset itself — the account is still
    // flagged must_change_password, which the app enforces at login and,
    // via the profiles realtime subscription, mid-session.
    if (userId !== caller.id) {
      try {
        await fetch(
          `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}/sessions`,
          {
            method: 'DELETE',
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
            },
          },
        )
      } catch {
        // Non-fatal — see comment above.
      }
    }

    return jsonResponse(200, { success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonResponse(500, { error: message })
  }
})
