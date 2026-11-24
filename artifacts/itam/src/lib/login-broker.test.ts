import { afterEach, describe, expect, it, vi } from 'vitest'
import { signInThroughBroker } from './login-broker'

afterEach(() => { vi.unstubAllGlobals() })

const stubFetch = (response: Response) => {
  const fetchMock = vi.fn(async () => response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('signInThroughBroker (client)', () => {
  it('posts to the broker, not to GoTrue, and returns the tokens', async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', password_change_required: false }), { status: 200 }))
    const session = await signInThroughBroker('synthetic@example.test', 'pw')
    expect(session).toEqual({ access_token: 'a', refresh_token: 'r', password_change_required: false })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toContain('/functions/v1/login-broker')
    expect(url).not.toContain('/auth/v1/token')
  })

  it('maps login_failed to the invalid-credentials message the login page recognises', async () => {
    stubFetch(new Response(JSON.stringify({ code: 'login_failed' }), { status: 401 }))
    await expect(signInThroughBroker('a@b.test', 'x')).rejects.toThrow(/invalid login credentials/i)
  })

  it('maps account_unavailable to an account message, not to a session', async () => {
    stubFetch(new Response(JSON.stringify({ code: 'account_unavailable' }), { status: 403 }))
    await expect(signInThroughBroker('a@b.test', 'x')).rejects.toThrow(/^Account unavailable$/)
  })

  it('maps login_unavailable to a temporary-unavailable message', async () => {
    stubFetch(new Response(JSON.stringify({ code: 'login_unavailable' }), { status: 503 }))
    await expect(signInThroughBroker('a@b.test', 'x')).rejects.toThrow(/temporarily unavailable/i)
  })

  it('maps invalid_input to a prompt to enter both fields', async () => {
    stubFetch(new Response(JSON.stringify({ code: 'invalid_input' }), { status: 400 }))
    await expect(signInThroughBroker('a@b.test', '')).rejects.toThrow(/enter your email and password/i)
  })

  it('refuses a success response without both tokens', async () => {
    stubFetch(new Response(JSON.stringify({ access_token: 'a' }), { status: 200 }))
    await expect(signInThroughBroker('a@b.test', 'x')).rejects.toThrow(/temporarily unavailable/i)
  })
})
