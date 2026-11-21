import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'node:fs';

// Applies every repository migration in order (including 00022) to a synthetic
// local PostgreSQL. This is not GoTrue or PostgREST; it checks grants and triggers only.
const migrationsDir = new URL('../../../../supabase/migrations/', import.meta.url);
const rollbackFile = new URL('../../../../supabase/rollbacks/20261101000022_profile_password_flag_guard.sql', import.meta.url);
const admin = '00000000-0000-4000-8000-000000000001';
const general = '00000000-0000-4000-8000-000000000002';
let db: PGlite;

async function asUser(id: string) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE authenticated;`);
}
async function asServiceRole() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); SET ROLE service_role;`);
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb, raw_app_meta_data jsonb DEFAULT '{}'::jsonb,last_sign_in_at timestamptz);
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
    UPDATE profiles SET must_change_password=true WHERE id='${general}';
  `);
}, 60000);
afterAll(async () => { if (db) await db.close(); });

describe('profile password-flag guard (migration 00022)', () => {
  it('blocks a signed-in user from clearing their own mandatory-password flag', async () => {
    await asUser(general);
    await expect(db.exec(`UPDATE profiles SET must_change_password=false WHERE id='${general}'`)).rejects.toThrow();
    await expect(db.exec(`UPDATE profiles SET password_changed_at=now() WHERE id='${general}'`)).rejects.toThrow();
    await db.exec('RESET ROLE');
    const { rows } = await db.query<{ must_change_password: boolean }>(`SELECT must_change_password FROM profiles WHERE id='${general}'`);
    expect(rows[0].must_change_password).toBe(true);
  });

  it('trigger alone blocks flag writes when column grants are widened', async () => {
    // Grants are the first guard. Widen them so only the trigger can block the write.
    await db.exec('GRANT UPDATE ON public.profiles TO authenticated');
    try {
      await asUser(general);
      await expect(db.exec(`UPDATE profiles SET must_change_password=false WHERE id='${general}'`)).rejects.toThrow(/Forbidden/);
      await expect(db.exec(`UPDATE profiles SET password_changed_at=now() WHERE id='${general}'`)).rejects.toThrow(/Forbidden/);
      await db.exec('RESET ROLE');
      const { rows } = await db.query<{ must_change_password: boolean }>(`SELECT must_change_password FROM profiles WHERE id='${general}'`);
      expect(rows[0].must_change_password).toBe(true);
    } finally {
      await db.exec('RESET ROLE');
      await db.exec('REVOKE UPDATE ON public.profiles FROM authenticated; GRANT UPDATE (role, full_name, department, is_active) ON public.profiles TO authenticated');
    }
  });

  it('still lets a general user update their own name and department', async () => {
    await asUser(general);
    await db.exec(`UPDATE profiles SET full_name='User Renamed', department='Ops' WHERE id='${general}'`);
    await db.exec('RESET ROLE');
  });

  it('still lets an administrator change roles and active status', async () => {
    await asUser(admin);
    await db.exec(`UPDATE profiles SET is_active=false WHERE id='${general}'`);
    await db.exec(`UPDATE profiles SET is_active=true WHERE id='${general}'`);
    await db.exec('RESET ROLE');
  });

  it('keeps the server path (service role / no JWT) able to set the flag', async () => {
    await asServiceRole();
    await db.exec(`UPDATE profiles SET must_change_password=false, password_changed_at=now() WHERE id='${general}'`);
    await db.exec(`UPDATE profiles SET must_change_password=true WHERE id='${general}'`);
    await db.exec('RESET ROLE');
  });

  it('lets a SECURITY DEFINER server function (owner role) set the flag for the caller', async () => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.test_complete_password_change() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ UPDATE profiles SET must_change_password=false, password_changed_at=now() WHERE id = auth.uid() $$;
      GRANT EXECUTE ON FUNCTION public.test_complete_password_change() TO authenticated;`);
    await asUser(general);
    await db.exec('SELECT public.test_complete_password_change()');
    await db.exec('RESET ROLE');
    await db.exec(`UPDATE profiles SET must_change_password=true, password_changed_at=NULL WHERE id='${general}'`);
  });

  it('rollback restores the previous table-level UPDATE grant', async () => {
    await db.exec(readFileSync(rollbackFile, 'utf8'));
    await asUser(general);
    await db.exec(`UPDATE profiles SET must_change_password=false WHERE id='${general}'`);
    await db.exec('RESET ROLE');
  });
});
