// Sign-in through the trusted password gate broker (Phase 3 step 3.2).
// The browser never calls signInWithPassword: every sign-in goes through the
// login-broker Edge Function, which admits the session in the database before
// returning tokens. Errors are mapped to the messages the login page already shows.

const UNAVAILABLE = 'Sign-in is temporarily unavailable. Try again shortly.'
const ACCOUNT_UNAVAILABLE = 'Account unavailable'

export interface BrokerSession {
  access_token: string
  refresh_token: string
  password_change_required: boolean
}

export async function signInThroughBroker(email: string, password: string): Promise<BrokerSession> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!url || !anonKey) throw new Error('Sign-in is not configured')

  const response = await fetch(`${url}/functions/v1/login-broker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ email, password }),
  })

  if (response.ok) {
    const body = await response.json() as Partial<BrokerSession>
    if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
      throw new Error(UNAVAILABLE)
    }
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      password_change_required: body.password_change_required === true,
    }
  }

  // Map the broker's error code to a message the login page understands.
  let code: unknown = null
  try {
    code = ((await response.json()) as { code?: unknown }).code
  } catch {
    code = null
  }
  if (code === 'invalid_input') throw new Error('Enter your email and password.')
  if (code === 'login_failed') throw new Error('Invalid login credentials')
  if (code === 'account_unavailable') throw new Error(ACCOUNT_UNAVAILABLE)
  throw new Error(UNAVAILABLE)
}
