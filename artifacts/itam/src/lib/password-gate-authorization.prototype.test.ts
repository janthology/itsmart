import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// Synthetic Postgres only. No GoTrue, JWT signature verification, gateway,
// Realtime, deployed Edge Functions, or real Auth session behavior is tested.
const user = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const session = '10000000-0000-4000-8000-000000000001';
const otherSession = '10000000-0000-4000-8000-000000000002';
const freshSession = '10000000-0000-4000-8000-000000000003';
const reset = '20000000-0000-4000-8000-000000000001';
const change = '20000000-0000-4000-8000-000000000002';
let db: PGlite;
async function asUser(sessionId: string | null, id = user) {
  const claims = JSON.stringify(sessionId ? { session_id: sessionId } : {});
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id, claims]);
  await db.exec('SET ROLE authenticated');
}
async function service(fn: string, operation: string) {
  await db.exec('RESET ROLE; SET ROLE service_role');
  await db.query(`SELECT public.${fn}($1,$2)`, [user, operation]);
  await db.exec('RESET ROLE');
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),not_after timestamptz);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text NOT NULL,is_active boolean NOT NULL DEFAULT true,must_change_password boolean NOT NULL DEFAULT false,password_changed_at timestamptz);
    INSERT INTO profiles(id,role) VALUES ('${user}','administrator'),('${other}','general_user');
    INSERT INTO auth.sessions(id,user_id) VALUES ('${session}','${user}'),('${otherSession}','${other}');
    GRANT USAGE ON SCHEMA public,private,auth TO authenticated,service_role;
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.profiles TO authenticated,service_role;
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY permissive_test ON profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);
    CREATE TABLE private.profile_contact_details(id uuid PRIMARY KEY);
    ALTER TABLE private.profile_contact_details ENABLE ROW LEVEL SECURITY;
    CREATE POLICY permissive_test ON private.profile_contact_details FOR ALL TO authenticated USING (true) WITH CHECK (true);
    GRANT SELECT,INSERT,UPDATE,DELETE ON private.profile_contact_details TO authenticated,service_role;
    DO $$DECLARE n text; BEGIN
      FOREACH n IN ARRAY ARRAY['categories','assets','asset_history','asset_maintenance_log','tickets','ticket_comments','notifications','admin_audit_log','entity_change_audit'] LOOP
        EXECUTE format('CREATE TABLE public.%I(id uuid PRIMARY KEY)',n);
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
        EXECUTE format('CREATE POLICY permissive_test ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',n);
        EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated,service_role',n);
        EXECUTE format('INSERT INTO public.%I(id) VALUES (%L)',n,'${user}');
      END LOOP;
    END$$;
  `);
  await db.exec(readFileSync(new URL('../../../../supabase/proposals/password-gate/operations.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../../../supabase/proposals/password-gate/authorization.sql', import.meta.url), 'utf8'));
});
afterAll(async () => db?.close());

describe('proposed password/session RLS (synthetic, not integrated)', () => {
  it('fails closed for an uninitialized user and limits profile visibility', async () => {
    await asUser(session);
    expect((await db.query('SELECT public.prototype_password_gate_status() AS state')).rows).toEqual([{ state: 'uninitialized' }]);
    for (const table of ['categories','assets','asset_history','asset_maintenance_log','tickets','ticket_comments','notifications','admin_audit_log','entity_change_audit']) {
      expect((await db.query(`SELECT id FROM public.${table}`)).rows, table).toEqual([]);
    }
    expect((await db.query('SELECT id FROM profiles')).rows).toEqual([{ id: user }]);
    expect((await db.query("UPDATE profiles SET role='general_user' WHERE id=$1 RETURNING id", [user])).rows).toEqual([]);
    await expect(db.query('INSERT INTO tickets(id) VALUES ($1)', [other])).rejects.toThrow(/row-level security/);
    expect((await db.query('SELECT public.prototype_gated_role() AS role')).rows).toEqual([{ role: null }]);
  });
  it('blocks data throughout reset and change; a service assertion alone is NOT real password proof', async () => {
    await service('prototype_begin_password_reset', reset);
    await asUser(session);
    expect((await db.query('SELECT public.prototype_password_gate_status() AS state')).rows).toEqual([{ state: 'resetting' }]);
    expect((await db.query('SELECT id FROM assets')).rows).toEqual([]);
    await service('prototype_finish_password_reset', reset);
    await service('prototype_begin_password_change', change);
    await asUser(session);
    expect((await db.query('SELECT public.prototype_password_gate_status() AS state')).rows).toEqual([{ state: 'changing' }]);
    expect((await db.query('SELECT id FROM tickets')).rows).toEqual([]);
    // Deliberately demonstrates why this proposal is incomplete: the service
    // can mark success without any Auth password operation having occurred.
    await service('prototype_finish_password_change', change);
    await asUser(session);
    expect((await db.query('SELECT public.prototype_password_gate_status() AS state')).rows).toEqual([{ state: 'reauthenticate' }]);
    expect((await db.query('SELECT id FROM tickets')).rows).toEqual([]);
    await db.exec('RESET ROLE');
    await db.query('INSERT INTO auth.sessions(id,user_id) VALUES ($1,$2)', [freshSession, user]);
    await asUser(freshSession);
    for (const table of ['categories','assets','asset_history','asset_maintenance_log','tickets','ticket_comments','notifications','admin_audit_log','entity_change_audit']) {
      expect((await db.query(`SELECT id FROM public.${table}`)).rows, table).toEqual([{ id: user }]);
    }
    expect((await db.query('SELECT public.prototype_gated_role() AS role')).rows).toEqual([{ role: 'administrator' }]);
    await expect(db.query('UPDATE profiles SET must_change_password=true WHERE id=$1', [user])).rejects.toThrow(/server-managed/);
  });
  it('rejects missing, malformed, wrong-user, expired and deleted sessions despite a cleared gate', async () => {
    for (const sid of [null, 'bad-uuid', otherSession]) {
      await asUser(sid);
      expect((await db.query('SELECT public.prototype_password_gate_status() AS state')).rows).toEqual([{ state: 'invalid_session' }]);
      expect((await db.query('SELECT id FROM tickets')).rows).toEqual([]);
      expect((await db.query('SELECT id FROM profiles')).rows).toEqual([]);
    }
    await db.exec("RESET ROLE; UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id='" + freshSession + "'");
    await asUser(freshSession);
    expect((await db.query('SELECT id FROM tickets')).rows).toEqual([]);
    await db.exec("RESET ROLE; DELETE FROM auth.sessions WHERE id='" + freshSession + "'");
    await asUser(freshSession);
    expect((await db.query('SELECT public.prototype_gated_role() AS role')).rows).toEqual([{ role: null }]);
    expect((await db.query('SELECT id FROM tickets')).rows).toEqual([]);
  });
  it('keeps the trusted service bypass and does not claim to constrain privileged database roles', async () => {
    await db.exec('RESET ROLE; SET ROLE service_role');
    expect((await db.query('SELECT id FROM tickets')).rows).toEqual([{ id: user }]);
    await db.exec('RESET ROLE');
  });
});
