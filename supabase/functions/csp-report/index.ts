// Receives Content-Security-Policy violation reports and stores a minimal,
// sanitized record in public.csp_violation_reports. Browsers send these
// without credentials, so verify_jwt must be false. The function accepts only
// POST bodies of the expected report types and size, and it stores only a
// fixed set of fields. Query strings and fragments are removed from URLs
// because they can contain tokens or personal data. Script samples are never
// stored.

const MAX_BODY_BYTES = 16 * 1024
const MAX_REPORTS = 20
const MAX_FIELD_LENGTH = 500
const ALLOWED_TYPES = new Set([
  'application/csp-report',
  'application/reports+json',
  'application/json',
])

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
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

function clip(value: unknown, max = MAX_FIELD_LENGTH): string | null {
  if (typeof value !== 'string') return null
  return value.slice(0, max)
}

// Keep scheme, host and path; drop the query string and fragment. Keywords
// such as 'inline' and 'eval' are kept as they are.
function sanitizeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    const url = new URL(value)
    if (url.protocol === 'data:' || url.protocol === 'blob:') return clip(`${url.protocol}`, 100)
    return clip(`${url.origin}${url.pathname}`)
  } catch {
    return clip(value.split(/[?#]/)[0], 200)
  }
}

function clipInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647
    ? value
    : null
}

type Row = {
  document_uri: string | null
  blocked_uri: string | null
  violated_directive: string | null
  effective_directive: string | null
  source_file: string | null
  line_number: number | null
  disposition: string | null
  user_agent: string | null
}

// Accepts the legacy application/csp-report shape and the Reporting API
// array shape (application/reports+json).
function toRows(payload: unknown, userAgent: string | null): Row[] {
  const items: Array<Record<string, unknown>> = []
  if (Array.isArray(payload)) {
    for (const item of payload.slice(0, MAX_REPORTS)) {
      if (item && typeof item === 'object' && (item as Record<string, unknown>).type === 'csp-violation') {
        const body = (item as Record<string, unknown>).body
        if (body && typeof body === 'object') items.push(body as Record<string, unknown>)
      }
    }
  } else if (payload && typeof payload === 'object') {
    const legacy = (payload as Record<string, unknown>)['csp-report']
    if (legacy && typeof legacy === 'object') items.push(legacy as Record<string, unknown>)
  }

  return items.map((report) => ({
    document_uri: sanitizeUrl(report['document-uri'] ?? report.documentURL),
    blocked_uri: sanitizeUrl(report['blocked-uri'] ?? report.blockedURL),
    violated_directive: clip(report['violated-directive'] ?? report.violatedDirective, 200),
    effective_directive: clip(report['effective-directive'] ?? report.effectiveDirective, 200),
    source_file: sanitizeUrl(report['source-file'] ?? report.sourceFile),
    line_number: clipInteger(report['line-number'] ?? report.lineNumber),
    disposition: clip(report.disposition, 20),
    user_agent: clip(userAgent, 300),
  }))
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!ALLOWED_TYPES.has(contentType)) {
    return jsonResponse(415, { error: 'Unsupported content type' })
  }

  const text = await req.text()
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: 'Report too large' })
  }

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' })
  }

  const rows = toRows(payload, req.headers.get('user-agent'))
  if (rows.length === 0) {
    // Nothing usable to store. Still answer without detail.
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = serviceRoleKey()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(500, { error: 'Supabase server configuration is missing' })
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/csp_violation_reports`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rows),
    })
    if (!response.ok) {
      return jsonResponse(503, { error: 'Report could not be stored' })
    }
  } catch {
    return jsonResponse(503, { error: 'Report could not be stored' })
  }

  return new Response(null, { status: 204, headers: corsHeaders })
})
