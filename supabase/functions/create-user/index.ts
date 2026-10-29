import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const VALID_ROLES = new Set(['general_user', 'support_staff', 'administrator'])

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing bearer token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Verify caller identity via GoTrue and enforce active administrator role
    const { data: callerData, error: callerError } = await admin.auth.getUser(token)
    if (callerError || !callerData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: callerProfile, error: callerProfileError } = await admin
      .from('profiles')
      .select('role, is_active')
      .eq('id', callerData.user.id)
      .single()

    if (
      callerProfileError ||
      !callerProfile ||
      callerProfile.role !== 'administrator' ||
      callerProfile.is_active !== true
    ) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: active administrator role required' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const { email, fullName, department, role } = await req.json()
    if (!email || typeof email !== 'string' || !fullName || typeof fullName !== 'string') {
      return new Response(JSON.stringify({ error: 'email and fullName are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const targetRole = role ?? 'general_user'
    if (!VALID_ROLES.has(targetRole)) {
      return new Response(JSON.stringify({ error: 'Invalid user role' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const normalizedName = fullName.trim()
    const normalizedDept =
      typeof department === 'string' && department.trim().length > 0 ? department.trim() : null

    // Create auth user with default initial password; user must change on first login
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password: 'dostro2',
      email_confirm: true,
      user_metadata: { full_name: normalizedName, department: normalizedDept },
    })
    if (authError) throw authError

    // Upsert profile with role and mandatory password change flag
    const { error: profileError } = await admin.from('profiles').upsert(
      {
        id: authData.user.id,
        full_name: normalizedName,
        department: normalizedDept,
        role: targetRole,
        is_active: true,
        must_change_password: true,
      },
      { onConflict: 'id' },
    )
    if (profileError) throw profileError

    return new Response(JSON.stringify({ success: true, userId: authData.user.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
