// RESEARCH PROTOTYPE ONLY — not deployed or integrated with the app.
// Depends on the proposal-only RLS/session and operation functions. A lost
// Auth update response deliberately leaves the operation locked; recovery is
// not implemented. Never log or return passwords, tokens or Auth responses.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, code: string) => new Response(JSON.stringify({ code }), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply(405, 'method_not_allowed')
  const base = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!base || !serviceKey) return reply(500, 'configuration_error')
  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return reply(401, 'authentication_required')
  let currentPassword: string
  let newPassword: string
  try {
    const body = await req.json() as { currentPassword?: unknown; newPassword?: unknown }
    if (typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') return reply(400, 'invalid_input')
    currentPassword = body.currentPassword
    newPassword = body.newPassword
    if (!currentPassword || currentPassword.length > 1024 || newPassword.length > 1024 || newPassword.length < 8 ||
        currentPassword === newPassword || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      return reply(400, 'invalid_input')
    }
  } catch { return reply(400, 'invalid_input') }

  const userHeaders = { apikey: serviceKey, Authorization: `Bearer ${token}` }
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }
  try {
    const userResponse = await fetch(`${base}/auth/v1/user`, { headers: userHeaders })
    if (!userResponse.ok) return reply(401, 'authentication_required')
    const caller = await userResponse.json() as { id?: unknown; email?: unknown }
    if (typeof caller.id !== 'string' || !uuid.test(caller.id) || typeof caller.email !== 'string' || !caller.email) return reply(403, 'unsupported_account')
    // PostgREST verifies the bearer JWT; the function checks that this JWT's
    // session still exists for the caller and that their gate is required.
    const stateResponse = await fetch(`${base}/rest/v1/rpc/prototype_password_gate_status`, {
      method: 'POST', headers: { ...userHeaders, 'Content-Type': 'application/json' }, body: '{}',
    })
    if (!stateResponse.ok || await stateResponse.json() !== 'required') return reply(403, 'change_unavailable')
    const operation = crypto.randomUUID()
    const rpc = (name: string) => fetch(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: serviceHeaders, body: JSON.stringify({ p_user: caller.id, p_operation: operation }),
    })
    // A lost response may have acquired the lock. Never send an Auth password
    // update or retry automatically unless begin is confirmed successful.
    let begun: Response
    try { begun = await rpc('prototype_begin_password_change') } catch { return reply(503, 'operation_unconfirmed') }
    if (!begun.ok) return reply(503, 'operation_unconfirmed')
    // Before the first password mutation only, a failed credential check can
    // safely release this operation. If releasing fails, remain fail-closed.
    const cancelBeforeMutation = async () => {
      try { return (await rpc('prototype_cancel_unattempted_change')).ok } catch { return false }
    }
    let verified: Response
    try {
      verified = await fetch(`${base}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: caller.email, password: currentPassword }),
      })
    } catch { return reply(503, await cancelBeforeMutation() ? 'verification_unavailable' : 'operation_unconfirmed') }
    if (!verified.ok) return reply(verified.status === 400 ? 400 : 503, await cancelBeforeMutation() ? 'verification_failed' : 'operation_unconfirmed')
    let verification: { access_token?: unknown; user?: { id?: unknown } }
    try { verification = await verified.json() as typeof verification } catch {
      return reply(503, await cancelBeforeMutation() ? 'verification_unavailable' : 'operation_unconfirmed')
    }
    if (typeof verification.access_token !== 'string' || !verification.access_token || verification.user?.id !== caller.id) {
      return reply(503, await cancelBeforeMutation() ? 'verification_unavailable' : 'operation_unconfirmed')
    }
    let authChange: Response
    try {
      authChange = await fetch(`${base}/auth/v1/user`, {
        method: 'PUT', headers: { apikey: serviceKey, Authorization: `Bearer ${verification.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      })
    } catch { return reply(503, 'change_unconfirmed') }
    if (!authChange.ok) return reply(503, 'change_unconfirmed')
    try {
      const changed = await authChange.json() as { id?: unknown }
      if (changed.id !== caller.id) return reply(503, 'change_unconfirmed')
    } catch { return reply(503, 'change_unconfirmed') }
    // Revoke sessions before clearing the gate; merely changing the password
    // does not establish that all old access JWTs are unusable. The proposal
    // also requires a new post-change session, and real GoTrue behavior and
    // concurrent in-flight sign-ins must still be tested before deployment.
    try {
      const revoked = await fetch(`${base}/auth/v1/logout?scope=global`, {
        method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${verification.access_token}` },
      })
      if (!revoked.ok) return reply(503, 'revocation_unconfirmed')
    } catch { return reply(503, 'revocation_unconfirmed') }
    try {
      if (!(await rpc('prototype_finish_password_change')).ok) return reply(503, 'completion_unconfirmed')
    } catch { return reply(503, 'completion_unconfirmed') }
    return reply(200, 'password_changed')
  } catch {
    // Do not echo raw fetch or server errors: they may contain secrets.
    return reply(503, 'request_unconfirmed')
  }
})
