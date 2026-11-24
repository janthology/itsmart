import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'node:fs';

// Step 3.2 fix: password_gate_broker_state (proposal). Local PGlite only, not live.
// Applies every repository migration, then the proposal, as the same harness as step 3.1.

const migrationsDir = new URL('../../../../supabase/migrations/', import.meta.url);
const proposalsDir = new URL('../../../../supabase/proposals/password-gate/', import.meta.url);
const script = (name: string) => readFileSync(new URL(name, migrationsDir), 'utf8');
const proposal = (name: string) => readFileSync(new URL(name, proposalsDir), 'utf8');

const admin = '00000000-0000-4000-8000-000000000001';
const general = '00000000-0000-4000-8000-000000000002';
const unknown = '00000000-0000-4000-8000-0000000000ff';
const gen = '50000000-0000-4000-8000-000000000001';

let db: PGlite;

async function asService() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); SET ROLE service_role;`);
}
async function asAnon() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); SET ROLE anon;`);
}
async function asUser(id: string) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE authenticated;`);
}
async function asPostgres() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);`);
}

async function expectDenied(run: () => Promise<unknown>) {
  await expect(run()).rejects.toThrow(/permission denied/i);
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
    UPDATE password_gate_state SET phase='cleared', operation_id='${gen}' WHERE user_id='${admin}';
  `);
  // The state row for the general user is the only one that matters for the phase checks.
  await db.exec(`INSERT INTO password_gate_state(user_id, phase, operation_id) VALUES ('${general}','required','${gen}') ON CONFLICT (user_id) DO NOTHING`);
  await db.exec(proposal('broker-state-read.sql'));
});

afterAll(async () => { await db?.close(); });

describe('password_gate_broker_state (service-only read)', () => {
  it('service_role reads the phase and operation_id for a user', async () => {
    await asService();
    const rows = await db.query<{ phase: string; operation_id: string }>(
      `SELECT phase, operation_id FROM public.password_gate_broker_state('${general}')`);
    expect(rows.rows).toEqual([{ phase: 'required', operation_id: gen }]);
  });

  it('returns no rows for an unknown user (the broker then refuses with 503)', async () => {
    await asService();
    const rows = await db.query(`SELECT * FROM public.password_gate_broker_state('${unknown}')`);
    expect(rows.rows).toEqual([]);
  });

  it('declares only phase and operation_id as output (no other state is exposed)', async () => {
    await asPostgres();
    const names = await db.query<{ names: string[] }>(`
      SELECT proargnames AS names FROM pg_proc
       WHERE proname = 'password_gate_broker_state' AND pronamespace = 'public'::regnamespace`);
    expect(names.rows[0].names).toEqual(['p_user', 'phase', 'operation_id']);
  });

  it('does not change any state', async () => {
    await asPostgres();
    const before = await db.query<{ n: string }>(`SELECT md5(string_agg(user_id::text || phase || operation_id::text || updated_at::text, '|' ORDER BY user_id)) AS n FROM public.password_gate_state`);
    await asService();
    await db.query(`SELECT * FROM public.password_gate_broker_state('${general}')`);
    await asPostgres();
    const after = await db.query<{ n: string }>(`SELECT md5(string_agg(user_id::text || phase || operation_id::text || updated_at::text, '|' ORDER BY user_id)) AS n FROM public.password_gate_state`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('anon and authenticated cannot execute it, even for their own id', async () => {
    await asAnon();
    await expectDenied(() => db.query(`SELECT * FROM public.password_gate_broker_state('${general}')`));
    await asUser(general);
    await expectDenied(() => db.query(`SELECT * FROM public.password_gate_broker_state('${general}')`));
    await asPostgres();
  });

  it('service_role still has no table privilege on password_gate_state', async () => {
    await asService();
    await expectDenied(() => db.query(`SELECT * FROM public.password_gate_state`));
    await asPostgres();
  });
});
