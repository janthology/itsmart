import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Handler = (request: Request) => Promise<Response>;

// Run the real Edge Function source in an isolated context. All fetches are
// supplied by the test, so no request can reach a real Supabase project.
function loadFunction(fetch: typeof globalThis.fetch): Handler {
  let handler: Handler | undefined;
  const source = readFileSync(new URL('../../../../supabase/functions/csp-report/index.ts', import.meta.url), 'utf8');
  const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  runInNewContext(script, {
    Deno: {
      serve: (fn: Handler) => { handler = fn; },
      env: { get: (key: string) => ({ SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' } as Record<string, string>)[key] },
    },
    crypto: webcrypto, fetch, Request, Response, URL, TextEncoder, JSON, Array, Number, String, Object, Promise, console,
  });
  if (!handler) throw new Error('Function did not register a handler');
  return handler;
}

const report = (body: unknown, type = 'application/csp-report', extra: Record<string, string> = {}) => new Request('https://synthetic.invalid/csp-report', {
  method: 'POST',
  headers: { 'content-type': type, 'user-agent': 'synthetic-agent', ...extra },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const legacy = {
  'csp-report': {
    'document-uri': 'https://app.example/tickets?token=secret#frag',
    'blocked-uri': 'https://evil.example/path?x=1',
    'violated-directive': 'script-src',
    'effective-directive': 'script-src-elem',
    'source-file': 'https://app.example/assets/app.js?v=2',
    'line-number': 12,
    disposition: 'enforce',
    'script-sample': 'SECRET INLINE SAMPLE',
  },
};

describe('csp-report: request handling', () => {
  it('answers preflight and rejects non-POST without storing', async () => {
    const fetch = vi.fn(() => { throw new Error('unexpected fetch'); });
    const handler = loadFunction(fetch as unknown as typeof globalThis.fetch);
    expect((await handler(new Request('https://synthetic.invalid', { method: 'OPTIONS' }))).status).toBe(204);
    expect((await handler(new Request('https://synthetic.invalid'))).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects unsupported content types, oversize bodies and invalid JSON before any insert', async () => {
    const fetch = vi.fn(() => { throw new Error('unexpected fetch'); });
    const handler = loadFunction(fetch as unknown as typeof globalThis.fetch);
    expect((await handler(report(legacy, 'text/plain'))).status).toBe(415);
    expect((await handler(report('x'.repeat(17 * 1024)))).status).toBe(413);
    expect((await handler(report('{not json'))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 204 without a database call when nothing usable is in the body', async () => {
    const fetch = vi.fn(() => { throw new Error('unexpected fetch'); });
    const handler = loadFunction(fetch as unknown as typeof globalThis.fetch);
    expect((await handler(report({ unrelated: true }))).status).toBe(204);
    expect((await handler(report([{ type: 'network-error', body: {} }], 'application/reports+json'))).status).toBe(204);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('csp-report: storage', () => {
  it('stores a legacy report with query strings removed and no script sample', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 201 }));
    const handler = loadFunction(fetch as unknown as typeof globalThis.fetch);
    const response = await handler(report(legacy));
    expect(response.status).toBe(204);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://synthetic.invalid/rest/v1/csp_violation_reports');
    const rows = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
    expect(rows).toEqual([{
      document_uri: 'https://app.example/tickets',
      blocked_uri: 'https://evil.example/path',
      violated_directive: 'script-src',
      effective_directive: 'script-src-elem',
      source_file: 'https://app.example/assets/app.js',
      line_number: 12,
      disposition: 'enforce',
      user_agent: 'synthetic-agent',
    }]);
    expect(JSON.stringify(rows)).not.toContain('SECRET');
    expect(JSON.stringify(rows)).not.toContain('token=');
  });

  it('stores Reporting API array entries and ignores other report types', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 201 }));
    const handler = loadFunction(fetch as unknown as typeof globalThis.fetch);
    const response = await handler(report([
      { type: 'csp-violation', body: { documentURL: 'https://app.example/a?b=c', blockedURL: 'inline', effectiveDirective: 'style-src-attr', disposition: 'report' } },
      { type: 'deprecation', body: { id: 'x' } },
    ], 'application/reports+json'));
    expect(response.status).toBe(204);
    const rows = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ document_uri: 'https://app.example/a', blocked_uri: 'inline', effective_directive: 'style-src-attr', disposition: 'report' });
  });

  it('caps the number of stored reports at 20', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 201 }));
    const handler = loadFunction(fetch as unknown as typeof globalThis.fetch);
    const many = Array.from({ length: 30 }, (_, i) => ({ type: 'csp-violation', body: { blockedURL: `https://x.example/${i}` } }));
    expect((await handler(report(many, 'application/reports+json'))).status).toBe(204);
    const rows = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Array<{ blocked_uri: string }>;
    expect(rows).toHaveLength(20);
  });

  it('truncates each stored field to 500 characters', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 201 }));
    const handler = loadFunction(fetch as unknown as typeof globalThis.fetch);
    await handler(report([{ type: 'csp-violation', body: { blockedURL: `https://x.example/${'a'.repeat(900)}` } }], 'application/reports+json'));
    const rows = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Array<{ blocked_uri: string }>;
    expect(rows[0].blocked_uri.length).toBe(500);
  });

  it('drops out-of-range line numbers rather than storing them', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 201 }));
    const handler = loadFunction(fetch as unknown as typeof globalThis.fetch);
    await handler(report({ 'csp-report': { 'blocked-uri': 'inline', 'line-number': -4 } }));
    const rows = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Array<{ line_number: unknown }>;
    expect(rows[0].line_number).toBeNull();
  });

  it('answers 503 without detail when the insert is rejected or the network fails', async () => {
    const rejected = vi.fn(async () => new Response('denied', { status: 403 }));
    expect((await loadFunction(rejected as unknown as typeof globalThis.fetch)(report(legacy))).status).toBe(503);
    const failed = vi.fn(async () => { throw new Error('network down'); });
    const response = await loadFunction(failed as unknown as typeof globalThis.fetch)(report(legacy));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('network down');
  });
});
