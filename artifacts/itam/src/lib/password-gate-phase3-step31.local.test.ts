import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'node:fs';

// Phase 3 step 3.0 addendum (MAINTAIN, profile INSERT) and step 3.1 (schema only).
// Local PostgreSQL 18 in PGlite. Not GoTrue, PostgREST or live Supabase.
// Live state for the MAINTAIN drift is the read-only catalog of 2026-11-23.

const migrationsDir = new URL('../../../../supabase/migrations/', import.meta.url);
const proposalsDir = new URL('../../../../supabase/proposals/password-gate/', import.meta.url);
const script = (name: string) => readFileSync(new URL(name, migrationsDir), 'utf8');
const proposal = (name: string) => readFileSync(new URL(name, proposalsDir), 'utf8');

const admin = '00000000-0000-4000-8000-000000000001';
const general = '00000000-0000-4000-8000-000000000002';
const fresh = '00000000-0000-4000-8000-000000000009';
const gen1 = '50000000-0000-4000-8000-000000000001';
const gen2 = '50000000-0000-4000-8000-000000000002';
const sessOld = '60000000-0000-4000-8000-000000000001';
const sessNew = '60000000-0000-4000-8000-000000000002';
const sessCleared = '60000000-0000-4000-8000-000000000003';
const sessBefore = '60000000-0000-4000-8000-000000000004';
const T_GATE = '2026-11-23T10:00:00Z';
const T_SESS_NEW = '2026-11-23T10:30:00Z';
const T_SESS_OLD = '2026-11-23T09:00:00Z';

let db: PGlite;
let preAddendum = '';

async function asUser(id: string) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE authenticated;`);
}
async function asService() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); SET ROLE service_role;`);
}
async function asAnon() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); SET ROLE anon;`);
}
async function asPostgres() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);`);
}

// Sorted MAINTAIN and profile-INSERT ACL rows, for exact before and after comparison.
async function maintainAndInsertState(): Promise<string> {
  const rel = await db.query<{ k: string }>(`
    SELECT c.relname || '|' || COALESCE(g.rolname,'PUBLIC') || '|' || a.privilege_type || '|' || a.is_grantable::text AS k
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    LEFT JOIN pg_roles g ON g.oid = a.grantee
    WHERE c.relkind IN ('r','p')
      AND (a.privilege_type = 'MAINTAIN' OR (a.privilege_type = 'INSERT' AND c.relname = 'profiles'))
    ORDER BY 1`);
  const def = await db.query<{ k: string }>(`
    SELECT 'default|' || COALESCE(g.rolname,'PUBLIC') || '|' || a.privilege_type || '|' || a.is_grantable::text AS k
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace AND n.nspname = 'public'
    JOIN pg_roles r ON r.oid = d.defaclrole AND r.rolname = 'postgres'
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    LEFT JOIN pg_roles g ON g.oid = a.grantee
    WHERE d.defaclobjtype = 'r' AND a.privilege_type = 'MAINTAIN'
    ORDER BY 1`);
  return JSON.stringify([...rel.rows.map(r => r.k), ...def.rows.map(r => r.k)]);
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
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
  await db.exec(`
    INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
      ('${admin}','admin@example.test','{"full_name":"Admin"}'),
      ('${general}','user@example.test','{"full_name":"User"}');
    UPDATE profiles SET role='administrator' WHERE id='${admin}';
  `);

  // Step 3.0 is live. Apply its proposal first, then recreate the live MAINTAIN shape
  // (read-only catalog, 2026-11-23). Table-level INSERT on profiles is already present
  // from the repository migrations, which matches live.
  await db.exec(proposal('grant-cleanup.sql'));
  await db.exec(`
    GRANT MAINTAIN ON public.assets, public.asset_history, public.asset_maintenance_log,
      public.categories, public.notifications, public.tickets, public.ticket_comments,
      public.profiles, public.profiles_with_email TO authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      GRANT MAINTAIN ON TABLES TO anon, authenticated, service_role;
  `);
  preAddendum = await maintainAndInsertState();
}, 60000);
afterAll(async () => { if (db) await db.close(); });

describe('step 3.0 addendum: MAINTAIN and profile column INSERT (local, not live)', () => {
  it('starts from the live shape: authenticated has MAINTAIN and table-level INSERT on profiles', async () => {
    expect(preAddendum).toContain('tickets|authenticated|MAINTAIN|false');
    expect(preAddendum).toContain('default|authenticated|MAINTAIN|false');
    await asPostgres();
    const r = await db.query<{ i: boolean }>(`SELECT has_table_privilege('authenticated','public.profiles','INSERT') AS i`);
    expect(r.rows[0].i).toBe(true);
  });

  it('applies the addendum: no MAINTAIN for anon or authenticated; no flag INSERT; register-style insert still allowed', async () => {
    await asPostgres();
    await db.exec(proposal('grant-cleanup-addendum.sql'));
    const m = await db.query<{ n: number }>(`
      SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      CROSS JOIN (VALUES ('anon'),('authenticated')) gr(r) JOIN pg_roles g ON g.rolname = gr.r
      WHERE c.relkind IN ('r','p') AND has_table_privilege(g.oid, c.oid, 'MAINTAIN')`);
    expect(m.rows[0].n).toBe(0);
    const d = await db.query<{ i: boolean; id: boolean; mcp: boolean; pca: boolean; fn: boolean }>(`
      SELECT has_table_privilege('authenticated','public.profiles','INSERT') AS i,
             has_column_privilege('authenticated','public.profiles','id','INSERT') AS id,
             has_column_privilege('authenticated','public.profiles','must_change_password','INSERT') AS mcp,
             has_column_privilege('authenticated','public.profiles','password_changed_at','INSERT') AS pca,
             has_column_privilege('authenticated','public.profiles','full_name','UPDATE') AS fn`);
    expect(d.rows[0]).toEqual({ i: false, id: true, mcp: false, pca: false, fn: true });
  });

  it('denies a flagged insert on a profile row by a signed-in user, and allows the register column set', async () => {
    await asPostgres();
    await db.exec(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ('${fresh}','fresh@example.test','{"full_name":"Fresh"}')`);
    await db.exec(`DELETE FROM public.profiles WHERE id='${fresh}'`);
    await asUser(fresh);
    await expect(db.query(
      `INSERT INTO public.profiles (id, full_name, role, must_change_password) VALUES ($1,'Fresh','general_user',false)`, [fresh],
    )).rejects.toThrow(/permission denied/);
    await asUser(fresh);
    const ok = await db.query<{ id: string }>(
      `INSERT INTO public.profiles (id, full_name, department, role) VALUES ($1,'Fresh','Ops','general_user')
       ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, department = EXCLUDED.department, role = EXCLUDED.role
       RETURNING id`, [fresh],
    );
    expect(ok.rows).toEqual([{ id: fresh }]);
    await asPostgres();
    const flags = await db.query<{ must_change_password: boolean }>(`SELECT must_change_password FROM public.profiles WHERE id='${fresh}'`);
    expect(flags.rows[0].must_change_password).toBe(false);
  });

  it('denies REINDEX to a signed-in user once MAINTAIN is revoked', async () => {
    await asUser(general);
    await expect(db.exec('REINDEX TABLE public.tickets')).rejects.toThrow(/permission denied/);
    await asPostgres();
  });

  it('rollback restores the exact pre-addendum MAINTAIN and profile INSERT state, then re-applying reaches the same state', async () => {
    await asPostgres();
    const after = await maintainAndInsertState();
    expect(after).not.toEqual(preAddendum);
    await db.exec(proposal('grant-cleanup-addendum-rollback.sql'));
    expect(await maintainAndInsertState()).toEqual(preAddendum);
    await db.exec(proposal('grant-cleanup-addendum.sql'));
    expect(await maintainAndInsertState()).toEqual(after);
  });
});

describe('step 3.1 schema (local, not live)', () => {
  it('applies the 3.1 schema without changing existing policies', async () => {
    await asPostgres();
    const before = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public'`);
    await db.exec(proposal('schema-step31.sql'));
    const after = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public'`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const col = await db.query<{ d: string }>(`SELECT column_default AS d FROM information_schema.columns WHERE table_schema='public' AND table_name='password_gate_admitted_sessions' AND column_name='scope'`);
    expect(col.rows[0].d).toContain("'full'");
  });

  it('settings: one row in shadow mode; only postgres can read or change it; invalid mode rejected', async () => {
    await asPostgres();
    const r = await db.query<{ n: number; m: string }>(`SELECT count(*)::int AS n, max(mode) AS m FROM public.password_gate_settings`);
    expect(r.rows[0]).toEqual({ n: 1, m: 'shadow' });
    await asUser(admin);
    await expect(db.query('SELECT * FROM public.password_gate_settings')).rejects.toThrow(/permission denied/);
    await asService();
    await expect(db.query('SELECT * FROM public.password_gate_settings')).rejects.toThrow(/permission denied/);
    await asAnon();
    await expect(db.query('SELECT * FROM public.password_gate_settings')).rejects.toThrow(/permission denied/);
    await asPostgres();
    await expect(db.exec("UPDATE public.password_gate_settings SET mode = 'off'")).rejects.toThrow(/check constraint/);
  });

  it('shadow log: no role except postgres can write it or use its sequence', async () => {
    for (const role of [asUser.bind(null, general), asService, asAnon]) {
      await role();
      await expect(db.exec(`INSERT INTO public.password_gate_shadow_log(user_id,object_name) VALUES ('${general}','tickets')`)).rejects.toThrow(/permission denied/);
    }
    await asPostgres();
    const seq = await db.query<{ a: boolean; b: boolean }>(`SELECT has_sequence_privilege('authenticated','public.password_gate_shadow_log_id_seq','USAGE') AS a, has_sequence_privilege('anon','public.password_gate_shadow_log_id_seq','USAGE') AS b`);
    expect(seq.rows[0]).toEqual({ a: false, b: false });
  });

  it('scope rejects unknown values', async () => {
    await asPostgres();
    await db.exec(`INSERT INTO auth.sessions(id,user_id,created_at) VALUES ('${sessBefore}','${general}','${T_SESS_OLD}')`);
    await expect(db.exec(`INSERT INTO public.password_gate_admitted_sessions(session_id,user_id,generation,scope) VALUES ('${sessBefore}','${general}','${gen1}','other')`)).rejects.toThrow(/check constraint/);
  });

  it('restricted admission: admits a flagged account for its generation and a fresh session; sets scope', async () => {
    await asPostgres();
    await db.exec(`INSERT INTO public.password_gate_state(user_id,phase,operation_id,updated_at) VALUES ('${general}','required','${gen1}','${T_GATE}')
      ON CONFLICT (user_id) DO UPDATE SET phase='required', operation_id='${gen1}', updated_at='${T_GATE}'`);
    await db.exec(`INSERT INTO auth.sessions(id,user_id,created_at) VALUES ('${sessNew}','${general}','${T_SESS_NEW}')`);
    await asService();
    await db.query('SELECT public.password_gate_admit_restricted_session($1,$2,$3)', [general, sessNew, gen1]);
    await asPostgres();
    const row = await db.query<{ scope: string; generation: string }>(`SELECT scope, generation::text AS generation FROM public.password_gate_admitted_sessions WHERE session_id='${sessNew}'`);
    expect(row.rows[0]).toEqual({ scope: 'password_change_only', generation: gen1 });
  });

  it('restricted admission refuses every case that is not a flagged, current, fresh session', async () => {
    await asService();
    // Wrong generation.
    await expect(db.query('SELECT public.password_gate_admit_restricted_session($1,$2,$3)', [general, sessOld, gen2])).rejects.toThrow(/generation changed|access unavailable/);
    // Session created before the gate state was set.
    await asPostgres();
    await db.exec(`INSERT INTO auth.sessions(id,user_id,created_at) VALUES ('${sessOld}','${general}','${T_SESS_OLD}')`);
    await asService();
    await expect(db.query('SELECT public.password_gate_admit_restricted_session($1,$2,$3)', [general, sessOld, gen1])).rejects.toThrow(/Session unavailable/);
    // Already admitted session: plain INSERT must not overwrite.
    await expect(db.query('SELECT public.password_gate_admit_restricted_session($1,$2,$3)', [general, sessNew, gen1])).rejects.toThrow(/duplicate key|unique/);
    // Missing session row.
    await expect(db.query('SELECT public.password_gate_admit_restricted_session($1,$2,$3)', [general, '60000000-0000-4000-8000-0000000000ff', gen1])).rejects.toThrow(/Session unavailable/);
    await asPostgres();
    // Phase 'resetting' is refused (ambiguous; locked until recovery).
    await db.exec(`UPDATE public.password_gate_state SET phase='resetting' WHERE user_id='${general}'`);
    await db.exec(`INSERT INTO auth.sessions(id,user_id,created_at) VALUES ('60000000-0000-4000-8000-0000000000fe','${general}','${T_SESS_NEW}')`);
    await asService();
    await expect(db.query('SELECT public.password_gate_admit_restricted_session($1,$2,$3)', [general, '60000000-0000-4000-8000-0000000000fe', gen1])).rejects.toThrow(/generation changed|access unavailable/);
    // Phase 'cleared' is refused by the restricted function (the full function handles it).
    await asPostgres();
    await db.exec(`UPDATE public.password_gate_state SET phase='cleared' WHERE user_id='${general}'`);
    await asService();
    await expect(db.query('SELECT public.password_gate_admit_restricted_session($1,$2,$3)', [general, '60000000-0000-4000-8000-0000000000fe', gen1])).rejects.toThrow(/generation changed|access unavailable/);
    // Inactive account is refused.
    await asPostgres();
    await db.exec(`UPDATE public.password_gate_state SET phase='required', updated_at='${T_GATE}' WHERE user_id='${general}'`);
    await db.exec(`UPDATE public.profiles SET is_active=false WHERE id='${general}'`);
    await asService();
    await expect(db.query('SELECT public.password_gate_admit_restricted_session($1,$2,$3)', [general, '60000000-0000-4000-8000-0000000000fe', gen1])).rejects.toThrow(/generation changed|access unavailable/);
    await asPostgres();
    await db.exec(`UPDATE public.profiles SET is_active=true WHERE id='${general}'`);
  });

  it('restricted admission is service-role only', async () => {
    await asUser(general);
    await expect(db.query('SELECT public.password_gate_admit_restricted_session($1,$2,$3)', [general, sessOld, gen1])).rejects.toThrow(/permission denied/);
    await asAnon();
    await expect(db.query('SELECT public.password_gate_admit_restricted_session($1,$2,$3)', [general, sessOld, gen1])).rejects.toThrow(/permission denied/);
    await asPostgres();
  });

  it('the Phase 1 full admission still works for a cleared account and records scope full', async () => {
    await asPostgres();
    await db.exec(`UPDATE public.password_gate_state SET phase='cleared', operation_id='${gen2}', updated_at='${T_GATE}' WHERE user_id='${general}'`);
    await db.exec(`INSERT INTO auth.sessions(id,user_id,created_at) VALUES ('${sessCleared}','${general}','2026-11-23T11:00:00Z')`);
    await asService();
    await db.query('SELECT public.password_gate_admit_session($1,$2,$3)', [general, sessCleared, gen2]);
    await asPostgres();
    const r = await db.query<{ scope: string }>(`SELECT scope FROM public.password_gate_admitted_sessions WHERE session_id='${sessCleared}'`);
    expect(r.rows[0].scope).toBe('full');
  });

  it('a restricted session cannot become full: a later cleared state rejects the old session on time', async () => {
    // sessNew was admitted restricted at T_SESS_NEW. Clearing at T_GATE+later refreshes
    // updated_at beyond sessNew.created_at, so the full function refuses it.
    await asPostgres();
    await db.exec(`UPDATE public.password_gate_state SET phase='cleared', operation_id='${gen2}', updated_at='2026-11-23T12:00:00Z' WHERE user_id='${general}'`);
    await asService();
    await expect(db.query('SELECT public.password_gate_admit_session($1,$2,$3)', [general, sessNew, gen2])).rejects.toThrow(/Session unavailable/);
    await asPostgres();
    const r = await db.query<{ scope: string }>(`SELECT scope FROM public.password_gate_admitted_sessions WHERE session_id='${sessNew}'`);
    expect(r.rows[0].scope).toBe('password_change_only');
  });

  it('3.1 rollback refuses while restricted sessions exist, then removes only the 3.1 objects', async () => {
    await asPostgres();
    await expect(db.exec(proposal('schema-step31-rollback.sql'))).rejects.toThrow(/restricted sessions exist/);
    await db.exec(`DELETE FROM public.password_gate_admitted_sessions WHERE scope <> 'full'`);
    await db.exec(proposal('schema-step31-rollback.sql'));
    const left = await db.query<{ f: string | null; s: string | null; l: string | null; c: number }>(`
      SELECT to_regprocedure('public.password_gate_admit_restricted_session(uuid,uuid,uuid)')::text AS f,
             to_regclass('public.password_gate_settings')::text AS s,
             to_regclass('public.password_gate_shadow_log')::text AS l,
             (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='password_gate_admitted_sessions' AND column_name='scope') AS c`);
    expect(left.rows[0]).toEqual({ f: null, s: null, l: null, c: 0 });
    // The Phase 1 gate still works after the rollback.
    await db.exec(`UPDATE public.password_gate_state SET phase='cleared', operation_id='${gen2}', updated_at='${T_GATE}' WHERE user_id='${general}'`);
    await db.exec(`INSERT INTO auth.sessions(id,user_id,created_at) VALUES ('60000000-0000-4000-8000-0000000000fd','${general}','2026-11-23T13:00:00Z')`);
    await asService();
    await db.query('SELECT public.password_gate_admit_session($1,$2,$3)', [general, '60000000-0000-4000-8000-0000000000fd', gen2]);
    await asPostgres();
    // Re-apply to confirm the package is repeatable.
    await db.exec(proposal('schema-step31.sql'));
    const again = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.password_gate_settings`);
    expect(again.rows[0].n).toBe(1);
  });
});
