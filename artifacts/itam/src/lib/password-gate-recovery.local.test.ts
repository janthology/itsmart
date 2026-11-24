import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'node:fs';

// Trusted password gate, Phase 4 (migration 20261124041419).
// Applies every repository migration, in order, to a synthetic local PostgreSQL. It checks the
// database contract only: which states are recoverable, the quiet period, stale expectations, the admin
// reset path afterwards, log privacy and rollback. It is not GoTrue or PostgREST, and it does not prove
// that a stranded account's Auth password is correct: that is the operator's check.
const migrationsDir = new URL('../../../../supabase/migrations/', import.meta.url);
const rollback = new URL('../../../../supabase/rollbacks/20261124041419_password_gate_recovery.sql', import.meta.url);
const admin = '00000000-0000-4000-8000-000000000001';
const general = '00000000-0000-4000-8000-000000000002';
const session = '00000000-0000-4000-8000-000000000003';
const op = (n: number) => `30000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

let db: PGlite;
async function asService() { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); SET ROLE service_role;`); }
async function asPostgres() { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);`); }
async function asUser(id: string) { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE authenticated;`); }
async function recover(expectedPhase: string, expectedOp: string, newOp: string) {
  await asService();
  try {
    await db.query('SELECT public.password_gate_recover_account($1,$2,$3,$4,$5,$6)',
      [general, expectedPhase, expectedOp, newOp, 'operator@example.test', 'test: stranded after ambiguous reset']);
    return null;
  } catch (e) { return String((e as Error).message); } finally { await asPostgres(); }
}
async function setGate(phase: string, operation: string, ageMinutes: number) {
  await asPostgres();
  await db.query(`INSERT INTO public.password_gate_state(user_id,phase,operation_id,updated_at)
    VALUES ($1,$2,$3, now() - make_interval(mins => $4))
    ON CONFLICT (user_id) DO UPDATE SET phase=EXCLUDED.phase, operation_id=EXCLUDED.operation_id, updated_at=EXCLUDED.updated_at`,
    [general, phase, operation, ageMinutes]);
}
async function gate() {
  await asPostgres();
  const r = await db.query<{ phase: string; operation_id: string }>('SELECT phase, operation_id FROM public.password_gate_state WHERE user_id=$1', [general]);
  return r.rows[0];
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
      ('${general}','user@example.test','{"full_name":"User"}');
    UPDATE profiles SET role='administrator' WHERE id='${admin}';
    INSERT INTO auth.sessions(id,user_id,created_at) VALUES ('${session}','${general}', now() - interval '2 hours');
  `);
}, 60000);
afterAll(async () => { if (db) await db.close(); });

describe('password gate Phase 4 recovery', () => {
  it('cannot be executed by PUBLIC, anon or authenticated; only service_role', async () => {
    await asPostgres();
    for (const role of ['anon', 'authenticated']) {
      const r = await db.query<{ ok: boolean }>('SELECT has_function_privilege($1,$2,$3) AS ok', [role, 'public.password_gate_recover_account(uuid,text,uuid,uuid,text,text)', 'EXECUTE']);
      expect(r.rows[0].ok, role).toBe(false);
    }
    const svc = await db.query<{ ok: boolean }>("SELECT has_function_privilege('service_role','public.password_gate_recover_account(uuid,text,uuid,uuid,text,text)','EXECUTE') AS ok");
    expect(svc.rows[0].ok).toBe(true);
  });

  it('the log is not readable by client roles', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await asPostgres();
      const r = await db.query<{ ok: boolean }>('SELECT has_table_privilege($1,$2,$3) AS ok', [role, 'public.password_gate_recovery_log', 'SELECT']);
      expect(r.rows[0].ok, role).toBe(false);
    }
  });

  it('refuses states that are not stuck (required, cleared, none)', async () => {
    for (const phase of ['required', 'cleared']) {
      await setGate(phase, op(10), 60);
      expect(await recover(phase, op(10), op(11)), phase).toMatch(/resetting or changing/);
    }
    await asPostgres();
    await db.query('DELETE FROM public.password_gate_state WHERE user_id=$1', [general]);
    expect(await recover('none', op(10), op(11))).toMatch(/resetting or changing/);
  });

  it('refuses a stale or wrong expected operation', async () => {
    await setGate('changing', op(20), 60);
    expect(await recover('changing', op(99), op(21))).toMatch(/does not match/);
    expect(await recover('resetting', op(20), op(21))).toMatch(/does not match/);
    expect(await gate()).toEqual({ phase: 'changing', operation_id: op(20) });
  });

  it('refuses inside the 15-minute quiet period', async () => {
    await setGate('changing', op(30), 5);
    expect(await recover('changing', op(30), op(31))).toMatch(/quiet period/);
    expect(await gate()).toEqual({ phase: 'changing', operation_id: op(30) });
  });

  it('refuses a reused operation ID', async () => {
    await setGate('changing', op(40), 60);
    expect(await recover('changing', op(40), op(40))).toMatch(/reused/);
  });

  it('moves a stuck change to required under a new operation, drops admissions, sets the flag and logs', async () => {
    await setGate('changing', op(50), 60);
    await asPostgres();
    await db.query('INSERT INTO public.password_gate_admitted_sessions(session_id,user_id,generation) VALUES ($1,$2,$3)', [session, general, op(50)]);
    expect(await recover('changing', op(50), op(51))).toBeNull();
    expect(await gate()).toEqual({ phase: 'required', operation_id: op(51) });
    await asPostgres();
    const adm = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.password_gate_admitted_sessions WHERE user_id=$1', [general]);
    expect(adm.rows[0].n).toBe(0);
    const prof = await db.query<{ must_change_password: boolean }>('SELECT must_change_password FROM profiles WHERE id=$1', [general]);
    expect(prof.rows[0].must_change_password).toBe(true);
    const log = await db.query<{ from_phase: string; from_operation: string; to_operation: string; actor: string }>('SELECT from_phase, from_operation, to_operation, actor FROM public.password_gate_recovery_log WHERE user_id=$1', [general]);
    expect(log.rows).toEqual([{ from_phase: 'changing', from_operation: op(50), to_operation: op(51), actor: 'operator@example.test' }]);
  });

  it('recovers a stuck reset the same way', async () => {
    await setGate('resetting', op(60), 60);
    expect(await recover('resetting', op(60), op(61))).toBeNull();
    expect(await gate()).toEqual({ phase: 'required', operation_id: op(61) });
  });

  it('after recovery, the normal admin reset path is open again', async () => {
    await asService();
    try {
      await db.query('SELECT public.password_gate_begin_reset($1,$2)', [general, op(70)]);
    } finally { await asPostgres(); }
    expect(await gate()).toEqual({ phase: 'resetting', operation_id: op(70) });
  });

  it('a reset that has just started cannot be recovered out from under the operator (quiet period)', async () => {
    // The admin reset above set updated_at to now: recovery must wait.
    expect(await recover('resetting', op(70), op(71))).toMatch(/quiet period/);
    expect(await gate()).toEqual({ phase: 'resetting', operation_id: op(70) });
    await setGate('resetting', op(72), 60);
    expect(await recover('resetting', op(72), op(72))).toMatch(/reused/);
  });

  it('a client role cannot read the recovery log', async () => {
    await asUser(admin);
    await expect(db.query('SELECT * FROM public.password_gate_recovery_log')).rejects.toThrow(/permission denied/);
    await asPostgres();
  });

  it('rollback refuses while the log has rows, and runs once it is empty', async () => {
    const sql = readFileSync(rollback, 'utf8');
    await expect(db.exec(sql)).rejects.toThrow(/rollback refused/);
    await asPostgres();
    await db.query('DELETE FROM public.password_gate_recovery_log');
    await db.exec(sql);
    const fn = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_proc WHERE proname='password_gate_recover_account'");
    expect(fn.rows[0].n).toBe(0);
  });
});
