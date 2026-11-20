import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// Synthetic sessions and trusted-service assertions only. No JWT signatures,
// actual password verification, GoTrue race, Edge broker or Realtime here.
const user = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const late = '10000000-0000-4000-8000-000000000001';
const verified = '10000000-0000-4000-8000-000000000002';
const otherSession = '10000000-0000-4000-8000-000000000003';
const expired = '10000000-0000-4000-8000-000000000004';
const fresh = '10000000-0000-4000-8000-000000000005';
const recovery = '10000000-0000-4000-8000-000000000006';
const reset = '20000000-0000-4000-8000-000000000001';
const change = '20000000-0000-4000-8000-000000000002';
const nextReset = '20000000-0000-4000-8000-000000000003';
const nextChange = '20000000-0000-4000-8000-000000000004';
let db: PGlite;
const load = (name: string) => readFileSync(new URL(`../../../../supabase/proposals/password-gate/${name}`, import.meta.url), 'utf8');
async function service() { await db.exec('RESET ROLE; SET ROLE service_role'); }
async function asUser(sid: string | null, actor = user) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)", [actor, JSON.stringify(sid ? { session_id: sid } : {})]);
  await db.exec('SET ROLE authenticated');
}
const admit = (sid: string, generation: string, actor = user) => db.query('SELECT public.prototype_admit_verified_session($1,$2,$3)', [actor, sid, generation]);
const access = async () => (await db.query('SELECT public.prototype_admitted_session_access_allowed() AS allowed')).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text NOT NULL);
    INSERT INTO auth.users(id,email) VALUES ('${user}','synthetic@example.invalid'),('${other}','other@example.invalid');
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),not_after timestamptz);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text NOT NULL,is_active boolean NOT NULL DEFAULT true,must_change_password boolean NOT NULL DEFAULT false,password_changed_at timestamptz);
    INSERT INTO profiles(id,role) VALUES ('${user}','administrator'),('${other}','general_user');
    GRANT USAGE ON SCHEMA public,private,auth TO authenticated,service_role;
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,INSERT,UPDATE,DELETE ON profiles TO authenticated,service_role;
    CREATE POLICY test_policy ON profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);
    CREATE TABLE private.profile_contact_details(id uuid PRIMARY KEY);
    ALTER TABLE private.profile_contact_details ENABLE ROW LEVEL SECURITY;
    DO $$DECLARE n text; BEGIN
      FOREACH n IN ARRAY ARRAY['categories','assets','asset_history','asset_maintenance_log','tickets','ticket_comments','notifications','admin_audit_log','entity_change_audit'] LOOP
        EXECUTE format('CREATE TABLE public.%I(id uuid PRIMARY KEY)',n);
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
      END LOOP;
    END$$;
  `);
  await db.exec(load('operations.sql'));
  await db.exec(load('authorization.sql'));
  await db.exec(load('session-authorization.sql'));
  await service();
  await db.query('SELECT public.prototype_begin_password_reset($1,$2)', [user, reset]);
  await db.query('SELECT public.prototype_finish_password_reset($1,$2)', [user, reset]);
  await db.query('SELECT public.prototype_begin_password_change($1,$2)', [user, change]);
  await db.query('SELECT public.prototype_finish_password_change($1,$2)', [user, change]);
  await db.exec('RESET ROLE');
  // A synthetic old-password login completing late is represented by a session
  // timestamp after completion; no actual GoTrue behavior is asserted.
  await db.query("INSERT INTO auth.sessions(id,user_id,created_at,not_after) VALUES ($1,$5,now()+interval '1 second',NULL),($2,$5,now()+interval '1 second',NULL),($3,$6,now(),NULL),($4,$5,now(),now()-interval '1 second')", [late, verified, otherSession, expired, user, other]);
});
afterAll(async () => db?.close());

describe('explicit session admission prototype (not integrated)', () => {
  it('shows timestamp-only authorization could accept a late synthetic session while admission denies it', async () => {
    await asUser(late);
    expect((await db.query('SELECT public.prototype_password_access_allowed() AS allowed')).rows).toEqual([{ allowed: true }]);
    expect(await access()).toEqual([{ allowed: false }]);
    await expect(db.query('SELECT * FROM public.password_session_authorization_prototype')).rejects.toThrow(/permission denied/);
    await expect(admit(late, change)).rejects.toThrow(/permission denied/);
    await expect(db.query('SELECT public.prototype_snapshot_login_generation($1)', [user])).rejects.toThrow(/permission denied/);
    await expect(db.query('SELECT * FROM public.prototype_snapshot_login_identity($1)', ['synthetic@example.invalid'])).rejects.toThrow(/permission denied/);
  });
  it('only admits the matching live session with the captured cleared generation', async () => {
    await service();
    await expect(db.query('SELECT * FROM public.password_session_authorization_prototype')).rejects.toThrow(/permission denied/);
    expect((await db.query('SELECT public.prototype_snapshot_login_generation($1) AS generation', [user])).rows).toEqual([{ generation: change }]);
    expect((await db.query('SELECT * FROM public.prototype_snapshot_login_identity($1)', [' SYNTHETIC@example.invalid '])).rows).toEqual([{ user_id: user, generation: change, gate_phase: 'cleared' }]);
    expect((await db.query('SELECT * FROM public.prototype_snapshot_login_identity($1)', ['missing@example.invalid'])).rows).toEqual([]);
    await db.exec(`RESET ROLE; INSERT INTO auth.users(id,email) VALUES ('00000000-0000-4000-8000-000000000099','SYNTHETIC@example.invalid')`);
    await service();
    expect((await db.query('SELECT * FROM public.prototype_snapshot_login_identity($1)', ['synthetic@example.invalid'])).rows).toEqual([]);
    await db.exec("RESET ROLE; DELETE FROM auth.users WHERE id='00000000-0000-4000-8000-000000000099'");
    await service();
    await expect(admit(otherSession, change)).rejects.toThrow(/Session unavailable/);
    await expect(admit(expired, change)).rejects.toThrow(/Session unavailable/);
    await admit(verified, change);
    await asUser(verified);
    expect(await access()).toEqual([{ allowed: true }]);
    await asUser(late);
    expect(await access()).toEqual([{ allowed: false }]);
    await asUser(verified, other);
    expect(await access()).toEqual([{ allowed: false }]);
  });
  it('invalidates admitted sessions when reset begins and rejects a stale snapshot after completion', async () => {
    await db.exec(`RESET ROLE; UPDATE auth.sessions SET created_at=now()-interval '1 day' WHERE id='${verified}'`);
    await service();
    await db.query('SELECT public.prototype_begin_password_reset($1,$2)', [user, nextReset]);
    expect((await db.query('SELECT public.prototype_snapshot_login_generation($1) AS generation', [user])).rows).toEqual([{ generation: null }]);
    await expect(admit(late, change)).rejects.toThrow(/Password generation changed/);
    await asUser(verified);
    expect(await access()).toEqual([{ allowed: false }]);
    await service();
    await db.query('SELECT public.prototype_finish_password_reset($1,$2)', [user, nextReset]);
    expect((await db.query('SELECT * FROM public.prototype_snapshot_login_identity($1)', ['synthetic@example.invalid'])).rows).toEqual([{ user_id:user, generation:nextReset, gate_phase:'required' }]);
    await db.exec('RESET ROLE');
    await db.query("INSERT INTO auth.sessions(id,user_id,created_at) VALUES ($1,$2,now()+interval '1 second')", [recovery, user]);
    await service();
    await db.query('SELECT public.prototype_confirm_recovery_session($1,$2,$3)', [user, recovery, nextReset]);
    await expect(db.query('SELECT public.prototype_confirm_recovery_session($1,$2,$3)', [user, recovery, change])).rejects.toThrow(/Password generation changed/);
    await asUser(recovery);
    expect((await db.query('SELECT public.prototype_password_gate_status() AS state')).rows).toEqual([{state:'required'}]);
    expect(await access()).toEqual([{allowed:false}]);
    await expect(db.query('SELECT public.prototype_confirm_recovery_session($1,$2,$3)', [user, recovery, nextReset])).rejects.toThrow(/permission denied/);
    await service();
    await db.query('SELECT public.prototype_begin_password_change($1,$2)', [user, nextChange]);
    await db.query('SELECT public.prototype_finish_password_change($1,$2)', [user, nextChange]);
    await expect(admit(late, change)).rejects.toThrow(/Password generation changed/);
    await asUser(verified);
    expect(await access()).toEqual([{ allowed: false }]);
    await service();
    await expect(admit(verified, nextChange)).rejects.toThrow(/Session unavailable/);
    await db.exec('RESET ROLE');
    await db.query("INSERT INTO auth.sessions(id,user_id,created_at) VALUES ($1,$2,now()+interval '1 second')", [fresh, user]);
    await service();
    // A trusted test caller asserts verification; SQL cannot verify passwords.
    await admit(fresh, nextChange);
    await asUser(fresh);
    expect(await access()).toEqual([{ allowed: true }]);
  });
  it('fails closed for inactive, expired, deleted or malformed sessions', async () => {
    await db.exec(`RESET ROLE; UPDATE profiles SET is_active=false WHERE id='${user}'`);
    await asUser(fresh);
    expect(await access()).toEqual([{ allowed: false }]);
    await service();
    await expect(admit(fresh, nextChange)).rejects.toThrow(/Password generation changed/);
    await db.exec(`RESET ROLE; UPDATE profiles SET is_active=true WHERE id='${user}'; UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id='${fresh}'`);
    await asUser(fresh);
    expect(await access()).toEqual([{ allowed: false }]);
    await db.exec(`RESET ROLE; DELETE FROM auth.sessions WHERE id='${fresh}'`);
    expect((await db.query('SELECT session_id FROM password_session_authorization_prototype WHERE session_id=$1', [fresh])).rows).toEqual([]);
    await asUser(fresh);
    expect(await access()).toEqual([{ allowed: false }]);
    await asUser('bad-uuid');
    expect(await access()).toEqual([{ allowed: false }]);
    await asUser(null);
    expect(await access()).toEqual([{ allowed: false }]);
  });
});
