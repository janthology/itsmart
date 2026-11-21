import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'node:fs';

// Trusted password gate, Phase 1 (migration 20261101000024). Applies every
// repository migration in order to a synthetic local PostgreSQL. This checks
// the database contract only: privileges, state transitions, stale and repeated
// completions, admission rules and the rollback. It is not GoTrue, PostgREST or
// Realtime, and PGlite is single-connection, so concurrency is tested separately
// against a disposable PostgreSQL server.
const migrationsDir = new URL('../../../../supabase/migrations/', import.meta.url);
const rollbackFile = new URL('../../../../supabase/rollbacks/20261101000024_password_gate_infrastructure.sql', import.meta.url);
const admin = '00000000-0000-4000-8000-000000000001';
const general = '00000000-0000-4000-8000-000000000002';
const second = '00000000-0000-4000-8000-000000000004';
const op = (n: number) => `30000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

let db: PGlite;
async function asUser(id: string) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE authenticated;`);
}
async function asService() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); SET ROLE service_role;`);
}
async function asPostgres() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);`);
}
async function phaseOf(user: string) {
  await asPostgres();
  const r = await db.query<{ phase: string; operation_id: string }>('SELECT phase, operation_id FROM public.password_gate_state WHERE user_id=$1', [user]);
  return r.rows[0] ?? null;
}
async function call(sql: string, params: unknown[]) {
  await asService();
  try {
    return await db.query(sql, params);
  } finally {
    await asPostgres();
  }
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
  const files = readdirSync(migrationsDir).filter(n => n.endsWith('.sql')).sort();
  for (const name of files) {
    if (name === '20261101000017_sla_recipient_dedup.sql') {
      await db.exec(`INSERT INTO auth.users(id,email) VALUES ('00000000-0000-4000-8000-000000000080','seed@example.test');
        INSERT INTO tickets(id,title,created_by,priority,status,created_at) VALUES ('00000000-0000-4000-8000-000000000081','LOCAL-SLA-PRECUTOVER','00000000-0000-4000-8000-000000000080','critical','in_progress',now()-interval '3 hours 10 minutes');
        INSERT INTO notifications(user_id,type,title,link) VALUES ('00000000-0000-4000-8000-000000000080','sla_at_risk','Prior','/tickets/00000000-0000-4000-8000-000000000081');`);
    }
    const sql = readFileSync(new URL(name, migrationsDir), 'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;', '-- pg_cron shim');
    try { await db.exec(sql); } catch (error) { throw new Error(`Migration ${name} failed`, { cause: error }); }
  }
  await db.exec(`
    INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
      ('${admin}','admin@example.test','{"full_name":"Admin"}'),
      ('${general}','user@example.test','{"full_name":"User"}'),
      ('${second}','second@example.test','{"full_name":"Second"}');
    UPDATE profiles SET role='administrator' WHERE id='${admin}';
  `);
}, 60000);
afterAll(async () => { if (db) await db.close(); });

describe('password gate Phase 1: privileges and non-enforcement', () => {
  it('enables RLS with no policies on both new tables, and no client role has table privileges', async () => {
    await asPostgres();
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('password_gate_state','password_gate_admitted_sessions') ORDER BY relname");
    expect(rls.rows).toEqual([
      { relname: 'password_gate_admitted_sessions', relrowsecurity: true },
      { relname: 'password_gate_state', relrowsecurity: true },
    ]);
    const policies = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_policies WHERE tablename IN ('password_gate_state','password_gate_admitted_sessions')");
    expect(policies.rows[0].n).toBe(0);
    for (const table of ['public.password_gate_state', 'public.password_gate_admitted_sessions']) {
      const publicTable = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM aclexplode((SELECT relacl FROM pg_class WHERE oid = to_regclass($1))) WHERE grantee = 0', [table]);
      expect(publicTable.rows[0].n, `PUBLIC ${table}`).toBe(0);
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          const r = await db.query<{ ok: boolean }>('SELECT has_table_privilege($1,$2,$3) AS ok', [role, table, priv]);
          expect(r.rows[0].ok, `${role} ${priv} ${table}`).toBe(false);
        }
      }
    }
  });

  it('grants the six functions only to service_role', async () => {
    await asPostgres();
    const fns = ['password_gate_begin_reset(uuid,uuid)', 'password_gate_finish_reset(uuid,uuid)', 'password_gate_begin_change(uuid,uuid)',
      'password_gate_cancel_unattempted_change(uuid,uuid)', 'password_gate_finish_change(uuid,uuid)', 'password_gate_admit_session(uuid,uuid,uuid)'];
    for (const fn of fns) {
      const sig = `public.${fn}`;
      expect((await db.query<{ ok: boolean }>('SELECT has_function_privilege($1,$2,$3) AS ok', ['service_role', sig, 'EXECUTE'])).rows[0].ok, fn).toBe(true);
      for (const role of ['anon', 'authenticated']) {
        expect((await db.query<{ ok: boolean }>('SELECT has_function_privilege($1,$2,$3) AS ok', [role, sig, 'EXECUTE'])).rows[0].ok, `${role} ${fn}`).toBe(false);
      }
      // PUBLIC is grantee 0 in the ACL, not a role name.
      const publicExec = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = to_regprocedure($1))) WHERE grantee = 0', [sig]);
      expect(publicExec.rows[0].n, `PUBLIC ${fn}`).toBe(0);
    }
  });

  it('is not referenced by any existing policy or function', async () => {
    await asPostgres();
    const policyRefs = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_policies WHERE coalesce(qual,'')||coalesce(with_check,'') ILIKE '%password_gate%' AND tablename NOT LIKE 'password_gate%'");
    expect(policyRefs.rows[0].n).toBe(0);
    const fnRefs = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosrc ILIKE '%password_gate%' AND p.proname NOT LIKE 'password_gate_%'");
    expect(fnRefs.rows[0].n).toBe(0);
  });

  it('denies a signed-in general user direct reads and calls', async () => {
    await asUser(general);
    await expect(db.query('SELECT * FROM public.password_gate_state')).rejects.toThrow(/permission denied/);
    await expect(db.query('SELECT public.password_gate_begin_reset($1,$2)', [general, op(1)])).rejects.toThrow(/permission denied/);
    await expect(db.query('SELECT public.password_gate_admit_session($1,$2,$3)', [general, op(1), op(2)])).rejects.toThrow(/permission denied/);
    await asPostgres();
  });

  it('denies anon entirely', async () => {
    await db.exec('RESET ROLE; SET ROLE anon;');
    await expect(db.query('SELECT public.password_gate_begin_reset($1,$2)', [general, op(1)])).rejects.toThrow(/permission denied/);
    await asPostgres();
  });
});

describe('password gate Phase 1: reset lifecycle', () => {
  it('does not change the existing profile flags at any step', async () => {
    await asPostgres();
    const before = await db.query('SELECT must_change_password, password_changed_at FROM profiles WHERE id=$1', [general]);
    await call('SELECT public.password_gate_begin_reset($1,$2)', [general, op(10)]);
    await call('SELECT public.password_gate_finish_reset($1,$2)', [general, op(10)]);
    await call('SELECT public.password_gate_begin_change($1,$2)', [general, op(11)]);
    await call('SELECT public.password_gate_finish_change($1,$2)', [general, op(11)]);
    await asPostgres();
    const after = await db.query('SELECT must_change_password, password_changed_at FROM profiles WHERE id=$1', [general]);
    expect(after.rows).toEqual(before.rows);
  });

  it('moves resetting -> required and accepts a repeated acknowledgement', async () => {
    await call('SELECT public.password_gate_begin_reset($1,$2)', [general, op(20)]);
    expect((await phaseOf(general))?.phase).toBe('resetting');
    await call('SELECT public.password_gate_finish_reset($1,$2)', [general, op(20)]);
    expect((await phaseOf(general))?.phase).toBe('required');
    await call('SELECT public.password_gate_finish_reset($1,$2)', [general, op(20)]);
    expect((await phaseOf(general))?.phase).toBe('required');
  });

  it('refuses a second reset while one is in progress, and a reused operation ID', async () => {
    await call('SELECT public.password_gate_begin_reset($1,$2)', [second, op(30)]);
    await expect(call('SELECT public.password_gate_begin_reset($1,$2)', [second, op(31)])).rejects.toThrow(/already in progress/);
    await call('SELECT public.password_gate_finish_reset($1,$2)', [second, op(30)]);
    await expect(call('SELECT public.password_gate_begin_reset($1,$2)', [second, op(30)])).rejects.toThrow(/ID reused/);
  });

  it('rejects a stale or wrong completion and leaves the current operation intact', async () => {
    await call('SELECT public.password_gate_begin_reset($1,$2)', [second, op(32)]);
    await expect(call('SELECT public.password_gate_finish_reset($1,$2)', [second, op(30)])).rejects.toThrow(/mismatch/);
    expect(await phaseOf(second)).toEqual({ phase: 'resetting', operation_id: op(32) });
    await call('SELECT public.password_gate_finish_reset($1,$2)', [second, op(32)]);
    expect((await phaseOf(second))?.phase).toBe('required');
  });

  it('allows a new reset on a required account (for example, an administrator reset)', async () => {
    await call('SELECT public.password_gate_begin_reset($1,$2)', [general, op(40)]);
    expect(await phaseOf(general)).toEqual({ phase: 'resetting', operation_id: op(40) });
    await call('SELECT public.password_gate_finish_reset($1,$2)', [general, op(40)]);
  });

  it('rejects an unknown profile and missing required arguments', async () => {
    const missing = '99999999-9999-4999-8999-999999999999';
    await expect(call('SELECT public.password_gate_begin_reset($1,$2)', [missing, op(50)])).rejects.toThrow(/Profile not found/);
    await expect(call('SELECT public.password_gate_begin_reset($1,$2)', [null, op(50)])).rejects.toThrow(/required/);
  });
});

describe('password gate Phase 1: change lifecycle', () => {
  it('does not start a change for an account with no state row (accounts are not initialized here)', async () => {
    const fresh = '00000000-0000-4000-8000-000000000005';
    await db.exec(`RESET ROLE; INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ('${fresh}','fresh@example.test','{"full_name":"Fresh"}') ON CONFLICT DO NOTHING`);
    await expect(call('SELECT public.password_gate_begin_change($1,$2)', [fresh, op(60)])).rejects.toThrow(/not available/);
    expect(await phaseOf(fresh)).toBeNull();
  });

  it('starts only from required, with a new operation ID, and only one at a time', async () => {
    // `second` is required after the reset tests above.
    expect((await phaseOf(second))?.phase).toBe('required');
    await expect(call('SELECT public.password_gate_begin_change($1,$2)', [second, op(32)])).rejects.toThrow(/not available/);
    await call('SELECT public.password_gate_begin_change($1,$2)', [second, op(61)]);
    expect(await phaseOf(second)).toEqual({ phase: 'changing', operation_id: op(61) });
    await expect(call('SELECT public.password_gate_begin_change($1,$2)', [second, op(62)])).rejects.toThrow(/not available/);
  });

  it('keeps a stale reset completion from clearing a later change', async () => {
    await expect(call('SELECT public.password_gate_finish_reset($1,$2)', [second, op(32)])).rejects.toThrow(/mismatch/);
    expect(await phaseOf(second)).toEqual({ phase: 'changing', operation_id: op(61) });
  });

  it('cancels only the matching, in-progress change, back to required', async () => {
    await expect(call('SELECT public.password_gate_cancel_unattempted_change($1,$2)', [second, op(62)])).rejects.toThrow(/mismatch/);
    await call('SELECT public.password_gate_cancel_unattempted_change($1,$2)', [second, op(61)]);
    expect((await phaseOf(second))?.phase).toBe('required');
    await expect(call('SELECT public.password_gate_cancel_unattempted_change($1,$2)', [second, op(61)])).rejects.toThrow(/mismatch/);
  });

  it('does not allow a change to reuse the operation ID of the current state', async () => {
    await expect(call('SELECT public.password_gate_begin_change($1,$2)', [second, op(61)])).rejects.toThrow(/not available/);
  });

  it('completes a change, accepts a repeated completion, and then rejects stale or late completions', async () => {
    await call('SELECT public.password_gate_begin_change($1,$2)', [second, op(63)]);
    await call('SELECT public.password_gate_finish_change($1,$2)', [second, op(63)]);
    expect(await phaseOf(second)).toEqual({ phase: 'cleared', operation_id: op(63) });
    await call('SELECT public.password_gate_finish_change($1,$2)', [second, op(63)]);
    await expect(call('SELECT public.password_gate_finish_change($1,$2)', [second, op(61)])).rejects.toThrow(/mismatch/);
    await expect(call('SELECT public.password_gate_finish_reset($1,$2)', [second, op(30)])).rejects.toThrow(/mismatch/);
    await expect(call('SELECT public.password_gate_cancel_unattempted_change($1,$2)', [second, op(63)])).rejects.toThrow(/mismatch/);
    await expect(call('SELECT public.password_gate_begin_change($1,$2)', [second, op(64)])).rejects.toThrow(/not available/);
  });

  it('refuses to complete a change that was never started', async () => {
    await expect(call('SELECT public.password_gate_finish_change($1,$2)', [general, op(70)])).rejects.toThrow(/mismatch/);
  });
});

describe('password gate Phase 1: admitted sessions', () => {
  const session = '40000000-0000-4000-8000-000000000001';
  const oldSession = '40000000-0000-4000-8000-000000000002';
  const expired = '40000000-0000-4000-8000-000000000003';
  const generation = op(63);

  it('admits a live session created after completion, under the current generation', async () => {
    await db.exec(`RESET ROLE; INSERT INTO auth.sessions(id,user_id,created_at) VALUES ('${session}','${second}',clock_timestamp());`);
    await call('SELECT public.password_gate_admit_session($1,$2,$3)', [second, session, generation]);
    const row = await db.query<{ generation: string }>('SELECT generation FROM public.password_gate_admitted_sessions WHERE session_id=$1', [session]);
    expect(row.rows).toEqual([{ generation }]);
  });

  it('refuses a session under a different generation', async () => {
    // Created before the change completed, so it is not admissible under any generation.
    await db.exec(`RESET ROLE; INSERT INTO auth.sessions(id,user_id,created_at) VALUES ('${oldSession}','${second}',(SELECT updated_at FROM public.password_gate_state WHERE user_id='${second}') - interval '1 hour');`);
    await expect(call('SELECT public.password_gate_admit_session($1,$2,$3)', [second, oldSession, op(61)])).rejects.toThrow(/generation changed/);
  });

  it('refuses a session created before the password change completed', async () => {
    await expect(call('SELECT public.password_gate_admit_session($1,$2,$3)', [second, oldSession, generation])).rejects.toThrow(/Session unavailable/);
  });

  it('refuses an expired session', async () => {
    await db.exec(`RESET ROLE; INSERT INTO auth.sessions(id,user_id,created_at,not_after) VALUES ('${expired}','${second}',clock_timestamp(),now()-interval '1 second');`);
    await expect(call('SELECT public.password_gate_admit_session($1,$2,$3)', [second, expired, generation])).rejects.toThrow(/Session unavailable/);
  });

  it('refuses admission for a state that is not cleared', async () => {
    await expect(call('SELECT public.password_gate_admit_session($1,$2,$3)', [general, session, op(40)])).rejects.toThrow(/generation changed|unavailable/);
  });

  it('refuses a session that belongs to another user', async () => {
    await db.exec(`RESET ROLE; INSERT INTO auth.sessions(id,user_id,created_at) VALUES ('40000000-0000-4000-8000-000000000009','${admin}',clock_timestamp());`);
    await expect(call('SELECT public.password_gate_admit_session($1,$2,$3)', [second, '40000000-0000-4000-8000-000000000009', generation])).rejects.toThrow(/Session unavailable/);
  });

  it('removes the admitted row when the Auth session is deleted', async () => {
    await db.exec(`RESET ROLE; DELETE FROM auth.sessions WHERE id='${session}';`);
    const row = await db.query('SELECT 1 FROM public.password_gate_admitted_sessions WHERE session_id=$1', [session]);
    expect(row.rows).toHaveLength(0);
  });

  it('is not callable by the signed-in user it would admit', async () => {
    await asUser(second);
    await expect(db.query('SELECT public.password_gate_admit_session($1,$2,$3)', [second, session, generation])).rejects.toThrow(/permission denied/);
    await asPostgres();
  });
});

describe('password gate Phase 1: rollback', () => {
  it('drops only its own objects, then restores them when the rollback is undone', async () => {
    const rollback = readFileSync(rollbackFile, 'utf8');
    await db.exec('BEGIN');
    try {
      await db.exec(rollback);
      const gone = await db.query<{ t: string | null; f: string | null }>(
        "SELECT to_regclass('public.password_gate_state')::text AS t, to_regprocedure('public.password_gate_begin_reset(uuid,uuid)')::text AS f");
      expect(gone.rows[0]).toEqual({ t: null, f: null });
      const profiles = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.profiles');
      expect(profiles.rows[0].n).toBeGreaterThan(0);
    } finally {
      await db.exec('ROLLBACK');
    }
    const back = await db.query<{ t: string | null }>("SELECT to_regclass('public.password_gate_state')::text AS t");
    expect(back.rows[0].t).toBe('password_gate_state');
  });
});
