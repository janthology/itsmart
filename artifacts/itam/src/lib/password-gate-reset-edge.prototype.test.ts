import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

// No real credentials, JWT validation, RLS, GoTrue or deployed Edge runtime.
const actor = '00000000-0000-4000-8000-000000000001';
const target = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const sid = '10000000-0000-4000-8000-000000000001';
const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({sub:actor,session_id:sid})).toString('base64url')}.signature`;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers:{'content-type':'application/json'}});
type Handler = (request: Request) => Promise<Response>;
type Options = { caller?: Response | Error; begin?: Response | Error; update?: Response | Error; finish?: Response | Error };
function setup(options: Options = {}) {
  const calls: {url:string; method:string; body?:any}[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? 'GET';
    calls.push({url, method, body:init?.body ? JSON.parse(String(init.body)) : undefined});
    let result: Response | Error;
    if (url.endsWith('/auth/v1/user')) result = options.caller ?? json({id:actor});
    else if (url.endsWith('/prototype_begin_authorized_password_reset')) result = options.begin ?? json(null);
    else if (url.includes('/auth/v1/admin/users/')) result = options.update ?? json({id:target});
    else if (url.endsWith('/prototype_finish_password_reset')) result = options.finish ?? json(null);
    else throw new Error('Unexpected mocked call');
    if (result instanceof Error) throw result;
    return result;
  });
  let handler: Handler | undefined;
  const source = readFileSync(new URL('../../../../supabase/proposals/password-gate/reset-password.ts', import.meta.url), 'utf8');
  const script = ts.transpile(source, {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None});
  runInNewContext(script, {Response,Request,JSON,atob,Uint32Array,crypto:webcrypto,fetch:fetchMock,Deno:{env:{get:(key:string)=>key==='SUPABASE_URL'?'https://synthetic.invalid':key==='SUPABASE_SERVICE_ROLE_KEY'?'synthetic-service-key':undefined},serve:(fn:Handler)=>{handler=fn;}}});
  if (!handler) throw new Error('No handler registered');
  return {handler,calls};
}
const request = (userId: string = target, bearer: string = token) => new Request('https://synthetic.invalid/function', {method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${bearer}`},body:JSON.stringify({userId})});

describe('gate-authorized reset Edge prototype (not deployed)', () => {
  it('verifies the caller, locks the reset before Auth and returns the password only after gate completion', async () => {
    const {handler,calls} = setup();
    const result = await handler(request());
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    const body = await result.json() as {code:string; temporaryPassword:string};
    expect(body.code).toBe('reset_required');
    expect(body.temporaryPassword).toHaveLength(20);
    expect(body.temporaryPassword).toMatch(/[a-z]/);
    expect(body.temporaryPassword).toMatch(/[A-Z]/);
    expect(body.temporaryPassword).toMatch(/[0-9]/);
    expect(body.temporaryPassword).toMatch(/[^A-Za-z0-9]/);
    expect(calls.map(c => c.url.split('/').at(-1))).toEqual(['user','prototype_begin_authorized_password_reset',target,'prototype_finish_password_reset']);
    expect(calls[1].body).toMatchObject({p_user:target,p_actor:actor,p_actor_session:sid});
    expect(calls[3].body).toEqual({p_user:target,p_operation:calls[1].body.p_operation});
    expect(calls[2].body.password).toBe(body.temporaryPassword);
    expect(JSON.stringify(calls[1].body)).not.toContain(body.temporaryPassword);
    expect(JSON.stringify(calls[3].body)).not.toContain(body.temporaryPassword);
  });
  it('rejects invalid tokens and self-reset before a privileged call', async () => {
    const a=setup(); expect((await a.handler(request(target,'not-a-jwt'))).status).toBe(401); expect(a.calls).toHaveLength(0);
    const b=setup(); expect((await b.handler(request(actor))).status).toBe(400); expect(b.calls).toHaveLength(0);
    const c=setup({caller:json({id:other})}); expect((await c.handler(request())).status).toBe(401); expect(c.calls).toHaveLength(1);
  });
  it.each([['database denial',json({},403)],['lost response',new Error('synthetic begin loss')]])('does not touch Auth if the begin step has %s', async (_label, begin) => {
    const {handler,calls} = setup({begin});
    const result=await handler(request());
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({code:'reset_unconfirmed'});
    expect(calls.some(c => c.url.includes('/admin/users/'))).toBe(false);
    expect(calls.some(c => c.url.endsWith('prototype_finish_password_reset'))).toBe(false);
  });
  it.each([
    ['Auth rejected',{update:json({},500)}],
    ['Auth response lost',{update:new Error('synthetic password loss')}],
    ['Auth identity mismatch',{update:json({id:other})}],
    ['gate completion failed',{finish:json({},500)}],
    ['gate completion response lost',{finish:new Error('synthetic finish loss')}],
  ])('returns no password and never retries after %s', async (_label, options) => {
    const {handler,calls} = setup(options);
    const result=await handler(request());
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({code:'reset_unconfirmed'});
    expect(calls.filter(c => c.url.includes('/admin/users/'))).toHaveLength(1);
    expect(calls.filter(c => c.url.endsWith('prototype_begin_authorized_password_reset'))).toHaveLength(1);
    if ('update' in options) expect(calls.some(c => c.url.endsWith('prototype_finish_password_reset'))).toBe(false);
  });
});
