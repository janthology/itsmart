import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'node:fs';

// Phase 3 step 3.3 (gate-aware helpers and restrictive scope policies), the gate backfill
// (step 3.2a) and their rollbacks. Shadow period skipped by user decision, 2026-11-24.
// Local PostgreSQL in PGlite. Not GoTrue, PostgREST, Realtime or live Supabase.

const migrationsDir = new URL('../../../../supabase/migrations/', import.meta.url);
const proposalsDir = new URL('../../../../supabase/proposals/password-gate/', import.meta.url);
const script = (name: string) => readFileSync(new URL(name, migrationsDir), 'utf8');
const proposal = (name: string) => readFileSync(new URL(name, proposalsDir), 'utf8');

const admin = '00000000-0000-4000-8000-000000000001';
const general = '00000000-0000-4000-8000-000000000002';
const support = '00000000-0000-4000-8000-000000000003';
const flagged = '00000000-0000-4000-8000-000000000004';
const nogate = '00000000-0000-4000-8000-000000000005';
const gen1 = '50000000-0000-4000-8000-000000000001';
const gen2 = '50000000-0000-4000-8000-000000000002';
const gen3 = '50000000-0000-4000-8000-000000000003';
const sAdmin = '60000000-0000-4000-8000-000000000001';
const sGeneral = '60000000-0000-4000-8000-000000000002';
const sSupport = '60000000-0000-4000-8000-000000000003';
const sFlagged = '60000000-0000-4000-8000-000000000004';
const sAdmin2 = '60000000-0000-4000-8000-000000000005';
const sUnknown = '60000000-0000-4000-8000-0000000000ff';
const T_GATE = '2026-11-23T10:00:00Z';
const T_SESS = '2026-11-23T10:30:00Z';

let db: PGlite;
let defsBefore = '';

async function asPostgres() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claims','{}',false);`);
}
// A signed-in session. Pass a session ID to model the broker's session_id claim.
async function asUser(sub: string, sessionId?: string) {
  await db.exec('RESET ROLE');
  const claims = JSON.stringify(sessionId ? { sub, session_id: sessionId } : { sub });
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)", [sub, claims]);
  await db.exec('SET ROLE authenticated');
}
async function asService() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claims','{}',false); SET ROLE service_role;`);
}
async function asAnon() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claims','{}',false); SET ROLE anon;`);
}
async function count(table: string): Promise<number> {
  const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${table}`);
  return r.rows[0].n;
}
async function mode(): Promise<string> {
  await asPostgres();
  const r = await db.query<{ m: string }>('SELECT mode AS m FROM public.password_gate_settings WHERE id = 1');
  return r.rows[0].m;
}
async function setMode(m: 'shadow' | 'enforce') {
  await asPostgres();
  await db.query('UPDATE public.password_gate_settings SET mode = $1, updated_at = clock_timestamp() WHERE id = 1', [m]);
}
async function helperDefs(): Promise<string> {
  await asPostgres();
  const r = await db.query<{ d: string }>(`SELECT string_agg(pg_get_functiondef(p.oid), E'\\n' ORDER BY p.proname) AS d
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('get_my_role', 'is_active_user')`);
  return r.rows[0].d;
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb, raw_app_meta_data jsonb DEFAULT '{}'::jsonb,last_sign_in_at timestamptz);
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),not_after timestamptz);
    CREATE SCHEMA cron;
    CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,jobname text UNIQUE,schedule text,command text);
    CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE plpgsql AS $$DECLARE i bigint; BEGIN INSERT INTO cron.job(jobname,schedule,command) VALUES ($1,$2,$3) ON CONFLICT(jobname) DO UPDATE SET schedule=$2,command=$3 RETURNING jobid INTO i; RETURN i; END$$;
    CREATE FUNCTION cron.unschedule(bigint) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN DELETE FROM cron.job WHERE jobid=$1; RETURN FOUND; END$$;
    CREATE PUBLICATION supabase_realtime;
  `);
  const files = readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort();
  for (const name of files) {
    const sql = script(name).replace('CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;', '-- pg_cron is replaced by an inert local test shim');
    try { await db.exec(sql); } catch (error) { throw new Error(`Migration ${name} failed`, { cause: error }); }
  }
  // Test accounts. Profiles are created by the repository's auth trigger.
  await db.exec(`
    INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
      ('${admin}','admin@example.test','{"full_name":"Admin"}'),
      ('${general}','user@example.test','{"full_name":"User"}'),
      ('${support}','support@example.test','{"full_name":"Support"}'),
      ('${flagged}','flagged@example.test','{"full_name":"Flagged"}');
    UPDATE profiles SET role='administrator' WHERE id='${admin}';
    UPDATE profiles SET role='support_staff' WHERE id='${support}';
  `);
  // Current state before this step: admitted sessions and the 3.0 and addendum grants.
  await db.exec(proposal('grant-cleanup.sql'));
  await db.exec(proposal('grant-cleanup-addendum.sql'));
  await db.exec(proposal('schema-step31.sql'));

  // Gate rows for the test accounts. Admin, general and support are cleared. Flagged is required.
  await db.exec(`
    INSERT INTO public.password_gate_state(user_id,phase,operation_id,updated_at) VALUES
      ('${admin}','cleared','${gen1}','${T_GATE}'),
      ('${general}','cleared','${gen1}','${T_GATE}'),
      ('${support}','cleared','${gen1}','${T_GATE}'),
      ('${flagged}','required','${gen2}','${T_GATE}');
    INSERT INTO auth.sessions(id,user_id,created_at) VALUES
      ('${sAdmin}','${admin}','${T_SESS}'),('${sGeneral}','${general}','${T_SESS}'),
      ('${sSupport}','${support}','${T_SESS}'),('${sFlagged}','${flagged}','${T_SESS}');
  `);
  // Seed business data as postgres (bypasses RLS).
  await db.exec(`
    INSERT INTO assets(asset_tag,name,category,status,assigned_to,next_pm_date) VALUES ('T-STEP33-1','Seed one',(enum_range(NULL::public.asset_category_type))[1],'active',NULL,'2099-01-01'),('T-STEP33-2','Seed two',(enum_range(NULL::public.asset_category_type))[1],'active',NULL,'2099-02-01');
    INSERT INTO tickets(title,created_by,status) VALUES ('ticket one','${general}','open'),('ticket two','${admin}','open');
    INSERT INTO notifications(user_id,type,title) VALUES ('${general}','test','n1'),('${flagged}','test','n2');
  `);
  defsBefore = await helperDefs();
}, 120000);
afterAll(async () => { if (db) await db.close(); });

describe('step 3.3 on top of 3.1 (local, not live)', () => {
  it('applies in shadow mode: restrictive policies in place, helpers reference the gate, settings unchanged', async () => {
    await asPostgres();
    await db.exec(proposal('enforcement-step33.sql'));
    expect(await mode()).toBe('shadow');
    const p = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND policyname='password_gate_scope' AND permissive='RESTRICTIVE'`);
    expect(p.rows[0].n).toBe(11);
    const defs = await helperDefs();
    expect(defs).toContain('password_gate_scope_ok');
    const ex = await db.query<{ anon: boolean; auth: boolean }>(`SELECT has_function_privilege('anon','public.password_gate_scope_ok()','EXECUTE') AS anon, has_function_privilege('authenticated','public.password_gate_scope_ok()','EXECUTE') AS auth`);
    expect(ex.rows[0]).toEqual({ anon: false, auth: true });
  });

  it('shadow is inert: an admin with no admitted session, and a flagged account with no admitted session, see what they saw before', async () => {
    await asUser(admin);
    expect(await count('assets')).toBe(2);
    const r = await db.query<{ r: string }>('SELECT public.get_my_role()::text AS r');
    expect(r.rows[0].r).toBe('administrator');
    await asUser(flagged);
    expect(await count('tickets')).toBe(2);
    // Own notifications only, as before: the flagged account has one.
    expect(await count('notifications')).toBe(1);
  });
});

describe('enforce mode (local)', () => {
  it('turns on enforce; an admin with no admitted session is denied everywhere', async () => {
    await setMode('enforce');
    expect(await mode()).toBe('enforce');
    await asUser(admin);
    const r = await db.query<{ r: string | null; a: boolean }>('SELECT public.get_my_role()::text AS r, public.is_active_user() AS a');
    expect(r.rows[0]).toEqual({ r: null, a: false });
    expect(await count('assets')).toBe(0);
    expect(await count('tickets')).toBe(0);
    expect(await count('notifications')).toBe(0);
  });

  it('carve-out: any signed-in account can read its own profile row, and nothing else', async () => {
    await asUser(admin);
    expect(await count('profiles')).toBe(1);
  });

  it('an unknown session ID in the claim is denied, even for an otherwise valid account', async () => {
    await asUser(admin, sUnknown);
    expect(await count('assets')).toBe(0);
  });

  it('a full admitted session restores the admin role and business reads', async () => {
    await asPostgres();
    await db.query('SELECT public.password_gate_admit_session($1,$2,$3)', [admin, sAdmin, gen1]);
    await asUser(admin, sAdmin);
    const r = await db.query<{ r: string }>('SELECT public.get_my_role()::text AS r');
    expect(r.rows[0].r).toBe('administrator');
    expect(await count('assets')).toBe(2);
  });

  it('a full admitted session restores support and general access under their roles', async () => {
    await asPostgres();
    await db.query('SELECT public.password_gate_admit_session($1,$2,$3)', [support, sSupport, gen1]);
    await db.query('SELECT public.password_gate_admit_session($1,$2,$3)', [general, sGeneral, gen1]);
    await asUser(support, sSupport);
    expect(await count('assets')).toBe(2);
    const s = await db.query<{ r: string }>('SELECT public.get_my_role()::text AS r');
    expect(s.rows[0].r).toBe('support_staff');
    await asUser(general, sGeneral);
    expect(await count('tickets')).toBe(2);
    expect(await count('notifications')).toBe(1);
    const g = await db.query<{ r: string }>('SELECT public.get_my_role()::text AS r');
    expect(g.rows[0].r).toBe('general_user');
  });

  it('a restricted session for a flagged account sees no business rows and only its own profile', async () => {
    await asPostgres();
    await db.query('SELECT public.password_gate_admit_restricted_session($1,$2,$3)', [flagged, sFlagged, gen2]);
    await asUser(flagged, sFlagged);
    const r = await db.query<{ r: string | null }>('SELECT public.get_my_role()::text AS r');
    expect(r.rows[0].r).toBeNull();
    expect(await count('assets')).toBe(0);
    expect(await count('tickets')).toBe(0);
    expect(await count('notifications')).toBe(0);
    expect(await count('profiles')).toBe(1);
  });

  it('a restricted session cannot write its own profile, and cannot create a ticket', async () => {
    await asUser(flagged, sFlagged);
    const upd = await db.query('UPDATE profiles SET full_name = $1 WHERE id = $2 RETURNING id', ['changed', flagged]);
    expect(upd.rows.length).toBe(0);
    await expect(db.query("INSERT INTO tickets(title,created_by) VALUES ('x',$1)", [flagged])).rejects.toThrow(/row-level security/);
    await asPostgres();
    const name = await db.query<{ n: string }>('SELECT full_name AS n FROM profiles WHERE id = $1', [flagged]);
    expect(name.rows[0].n).toBe('Flagged');
  });

  it('a session admitted before an admin reset is denied after it; a new generation admits again', async () => {
    await asPostgres();
    await db.exec(`UPDATE password_gate_state SET phase='resetting', operation_id='${gen3}', updated_at='2026-11-23T11:00:00Z' WHERE user_id='${admin}'`);
    await asUser(admin, sAdmin);
    expect(await count('assets')).toBe(0);
    await asPostgres();
    await db.exec(`UPDATE password_gate_state SET phase='cleared', operation_id='${gen3}', updated_at='2026-11-23T11:30:00Z' WHERE user_id='${admin}'`);
    await asUser(admin, sAdmin);
    expect(await count('assets')).toBe(0);
    await asPostgres();
    await db.exec("INSERT INTO auth.sessions(id,user_id,created_at) VALUES ('" + sAdmin2 + "','" + admin + "','2026-11-23T12:00:00Z')");
    await db.query('SELECT public.password_gate_admit_session($1,$2,$3)', [admin, sAdmin2, gen3]);
    await asUser(admin, sAdmin2);
    expect(await count('assets')).toBe(2);
  });

  it('an inactive account is denied even with a full admitted session; reactivation restores it', async () => {
    await asPostgres();
    await db.exec(`UPDATE profiles SET is_active=false WHERE id='${support}'`);
    await asUser(support, sSupport);
    expect(await count('assets')).toBe(0);
    await asPostgres();
    await db.exec(`UPDATE profiles SET is_active=true WHERE id='${support}'`);
    await asUser(support, sSupport);
    expect(await count('assets')).toBe(2);
  });

  it('the gate backfill is required: an account with no gate row cannot be admitted', async () => {
    await asPostgres();
    await db.exec(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ('${nogate}','nogate@example.test','{"full_name":"No gate"}')`);
    await db.exec("INSERT INTO auth.sessions(id,user_id,created_at) VALUES ('60000000-0000-4000-8000-000000000006','" + nogate + "',clock_timestamp())");
    await expect(db.query('SELECT public.password_gate_admit_session($1,$2,$3)', [nogate, '60000000-0000-4000-8000-000000000006', gen1])).rejects.toThrow(/access unavailable|generation changed/);
  });

  it('service role, cron functions and guards run with no session', async () => {
    await asService();
    expect(await count('assets')).toBe(2);
    await asPostgres();
    await db.exec('SELECT public.cleanup_old_notifications(365)');
    await db.exec('SELECT public.generate_pm_notifications()');
    await db.exec('SELECT public.auto_close_resolved_tickets()');
    await db.exec(`UPDATE tickets SET status='in_progress' WHERE title='ticket two'`);
    const t = await db.query<{ s: string }>(`SELECT status::text AS s FROM tickets WHERE title='ticket two'`);
    expect(t.rows[0].s).toBe('in_progress');
  });

  it('anon has no table path and no helper value', async () => {
    await asAnon();
    await expect(db.query('SELECT count(*) FROM assets')).rejects.toThrow(/permission denied/);
    const r = await db.query<{ r: string | null }>('SELECT public.get_my_role()::text AS r');
    expect(r.rows[0].r).toBeNull();
  });
});

describe('backfill (step 3.2a, local)', () => {
  it('creates a cleared row for the account without one, and then the account can be admitted', async () => {
    await asPostgres();
    await db.exec(proposal('gate-backfill-cleared.sql'));
    const row = await db.query<{ p: string }>(`SELECT phase AS p FROM password_gate_state WHERE user_id='${nogate}'`);
    expect(row.rows[0].p).toBe('cleared');
    await db.exec("INSERT INTO auth.sessions(id,user_id,created_at) VALUES ('60000000-0000-4000-8000-000000000007','" + nogate + "',clock_timestamp())");
    const gen = await db.query<{ g: string }>(`SELECT operation_id::text AS g FROM password_gate_state WHERE user_id='${nogate}'`);
    await db.query('SELECT public.password_gate_admit_session($1,$2,$3)', [nogate, '60000000-0000-4000-8000-000000000007', gen.rows[0].g]);
    // A general user sees only the assets assigned to them (migration 20261124060000).
    await asPostgres();
    await db.exec(`UPDATE assets SET assigned_to='${nogate}' WHERE asset_tag='T-STEP33-1'`);
    await asUser(nogate, '60000000-0000-4000-8000-000000000007');
    expect(await count('assets')).toBe(1);
    await asPostgres();
    await db.exec(`UPDATE assets SET assigned_to=NULL WHERE asset_tag='T-STEP33-1'`);
  });

  it('rollback removes only the rows the backfill created, then re-applies cleanly', async () => {
    await asPostgres();
    // Sanity: a row that changed after the backfill is not removed by the rollback.
    await db.exec(`UPDATE password_gate_state SET phase='required' WHERE user_id='${nogate}'`);
    await db.exec(proposal('gate-backfill-cleared-rollback.sql'));
    const left = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM password_gate_state WHERE user_id='${nogate}'`);
    expect(left.rows[0].n).toBe(1);
    await db.exec(`DELETE FROM password_gate_state WHERE user_id='${nogate}'`);
    await db.exec(proposal('gate-backfill-cleared.sql'));
    const again = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM password_gate_state WHERE user_id='${nogate}'`);
    expect(again.rows[0].n).toBe(1);
  });
});

describe('fast rollback and structural rollback (local)', () => {
  it('switching back to shadow restores access without a deploy', async () => {
    await setMode('shadow');
    await asUser(admin);
    expect(await count('assets')).toBe(2);
    await setMode('enforce');
    await asUser(admin);
    expect(await count('assets')).toBe(0);
  });

  it('the structural rollback restores the helper definitions exactly and removes the scope policies', async () => {
    await asPostgres();
    await db.exec(proposal('enforcement-step33-rollback.sql'));
    expect(await helperDefs()).toBe(defsBefore);
    const p = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND policyname='password_gate_scope'`);
    expect(p.rows[0].n).toBe(0);
    const f = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('password_gate_scope_ok','password_gate_full_session','password_gate_enforcement_mode')`);
    expect(f.rows[0].n).toBe(0);
    await asUser(admin);
    expect(await count('assets')).toBe(2);
  });

  it('refuses to roll back without the snapshot', async () => {
    await asPostgres();
    await expect(db.exec(proposal('enforcement-step33-rollback.sql'))).rejects.toThrow(/No step 3.3 snapshot/);
  });
});
