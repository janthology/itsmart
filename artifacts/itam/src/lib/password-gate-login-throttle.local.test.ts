import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'node:fs';

// Login throttle (migration 20261124051703), applied after every repository migration on a
// synthetic local PostgreSQL. Covers the counter, the lock, expiry, the window, key validation,
// privileges and the rollback. The broker's use of it is tested in login-broker-edge.test.ts.
const migrationsDir = new URL('../../../../supabase/migrations/', import.meta.url);
const rollbackFile = new URL('../../../../supabase/rollbacks/20261124051703_password_gate_login_throttle.sql', import.meta.url);
const keyA = 'a'.repeat(64);
const keyB = 'b'.repeat(64);

let db: PGlite;
async function asPostgres() { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);`); }
async function asService() { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); SET ROLE service_role;`); }
async function asRole(role: string) { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); SET ROLE ${role};`); }
async function call(fn: string, key: string) {
  await asService();
  try { return (await db.query<{ v: unknown }>(`SELECT public.${fn}($1) AS v`, [key])).rows[0].v; } finally { await asPostgres(); }
}
const check = (key: string) => call('password_gate_login_check', key);
const failed = (key: string) => call('password_gate_login_failed', key);
const succeeded = (key: string) => call('password_gate_login_succeeded', key);
async function row(key: string) {
  await asPostgres();
  const r = await db.query<{ failures: number; window_started_at: Date; locked_until: Date | null }>(
    'SELECT failures, window_started_at, locked_until FROM public.password_gate_login_throttle WHERE throttle_key=$1', [key]);
  return r.rows[0] ?? null;
}
async function age(key: string, sql: string) {
  await asPostgres();
  await db.query(`UPDATE public.password_gate_login_throttle SET ${sql} WHERE throttle_key=$1`, [key]);
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
}, 60000);
afterAll(async () => { if (db) await db.close(); });

describe('login throttle: counting and lock', () => {
  it('counts wrong passwords and locks on the fifth, for 15 minutes', async () => {
    for (let i = 1; i <= 4; i++) expect(await failed(keyA)).toBe(0);
    expect((await row(keyA))!.failures).toBe(4);
    const fifth = Number(await failed(keyA));
    expect(fifth).toBeGreaterThan(14 * 60);
    expect(fifth).toBeLessThanOrEqual(15 * 60);
    expect((await row(keyA))!.locked_until).not.toBeNull();
  });

  it('check reports the seconds left while locked', async () => {
    const left = Number(await check(keyA));
    expect(left).toBeGreaterThan(14 * 60);
    expect(left).toBeLessThanOrEqual(15 * 60);
  });

  it('a different key is not affected', async () => {
    expect(Number(await check(keyB))).toBe(0);
  });

  it('a successful password clears the count and any lock', async () => {
    await succeeded(keyA);
    expect(await row(keyA)).toBeNull();
    expect(Number(await check(keyA))).toBe(0);
  });
});

describe('login throttle: window and expiry', () => {
  it('failures outside the 15-minute window start a new count', async () => {
    await failed(keyB); await failed(keyB);
    expect((await row(keyB))!.failures).toBe(2);
    await age(keyB, "window_started_at = clock_timestamp() - interval '16 minutes'");
    expect(await failed(keyB)).toBe(0);
    expect((await row(keyB))!.failures).toBe(1);
  });

  it('once a lock has expired, the next wrong password starts a fresh count, not an instant re-lock', async () => {
    await succeeded(keyB);
    for (let i = 0; i < 5; i++) await failed(keyB);
    expect(Number(await check(keyB))).toBeGreaterThan(0);
    await age(keyB, "locked_until = clock_timestamp() - interval '1 second'");
    expect(Number(await check(keyB))).toBe(0);
    expect(await failed(keyB)).toBe(0);
    expect((await row(keyB))!.failures).toBe(1);
    expect((await row(keyB))!.locked_until).toBeNull();
  });
});

describe('login throttle: input, privileges and rollback', () => {
  it('rejects a key that is not 64 lower-case hex characters', async () => {
    for (const bad of ['', 'short', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), `${'a'.repeat(64)}x`]) {
      await expect(check(bad)).rejects.toThrow(/Invalid throttle key/);
      await expect(failed(bad)).rejects.toThrow(/Invalid throttle key/);
      await expect(succeeded(bad)).rejects.toThrow(/Invalid throttle key/);
    }
  });

  it('no client role can read or write the table, or execute the functions', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await asPostgres();
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const r = await db.query<{ ok: boolean }>('SELECT has_table_privilege($1,$2,$3) AS ok', [role, 'public.password_gate_login_throttle', priv]);
        expect(r.rows[0].ok, `${role} ${priv}`).toBe(false);
      }
    }
    for (const role of ['anon', 'authenticated']) {
      for (const fn of ['password_gate_login_check(text)', 'password_gate_login_failed(text)', 'password_gate_login_succeeded(text)']) {
        await asPostgres();
        const r = await db.query<{ ok: boolean }>('SELECT has_function_privilege($1,$2,$3) AS ok', [role, `public.${fn}`, 'EXECUTE']);
        expect(r.rows[0].ok, `${role} ${fn}`).toBe(false);
      }
    }
    await asPostgres();
    const svc = await db.query<{ ok: boolean }>("SELECT has_function_privilege('service_role','public.password_gate_login_failed(text)','EXECUTE') AS ok");
    expect(svc.rows[0].ok).toBe(true);
  });

  it('a client role cannot read the table even as a counted account', async () => {
    await asRole('authenticated');
    await expect(db.query('SELECT * FROM public.password_gate_login_throttle')).rejects.toThrow(/permission denied/);
    await asPostgres();
  });

  it('rollback removes the functions and the table, and the migration applies again cleanly', async () => {
    await asPostgres();
    await db.exec(readFileSync(rollbackFile, 'utf8'));
    const left = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'password_gate_login_%'");
    expect(left.rows[0].n).toBe(0);
    await db.exec(readFileSync(new URL('20261124051703_password_gate_login_throttle.sql', migrationsDir), 'utf8'));
    expect(Number(await check(keyA))).toBe(0);
    expect(await failed(keyA)).toBe(0);
  });
});
