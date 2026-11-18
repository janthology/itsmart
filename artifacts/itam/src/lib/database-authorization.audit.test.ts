import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const source = (file: string) => readFileSync(new URL(`../../../../supabase/migrations/${file}`, import.meta.url), 'utf8');
const initial = source('20261028000001_initial_schema.sql');
const hardening = source('20261028000002_safe_p0_hardening_rls_and_cron.sql');
const readAll = source('20261030000006_general_users_view_all_tickets.sql');
const pmGuard = source('20261101000013_complete_maintenance_cutover.sql');
function functionSql(sql: string, name: string): string {
  const match = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`, 'i'));
  if (!match) throw new Error(`Missing ${name}`);
  return match[0];
}
function policySql(sql: string, name: string): string {
  const match = sql.match(new RegExp(`CREATE POLICY ${name}\\b[\\s\\S]*?;`, 'i'));
  if (!match) throw new Error(`Missing ${name}`);
  return match[0];
}
const general = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const support = '00000000-0000-4000-8000-000000000003';
const inactive = '00000000-0000-4000-8000-000000000004';
let db: PGlite;

// An isolated, simplified PostgreSQL model, using the actual migration policy
// and guard definitions; no real data or live Supabase connections are used.
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TYPE public.user_role AS ENUM ('general_user','support_staff','administrator');
    CREATE TYPE public.ticket_status AS ENUM ('open','in_progress','on_hold','resolved','closed');
    CREATE TABLE public.profiles (id uuid PRIMARY KEY, role public.user_role NOT NULL, is_active boolean NOT NULL, must_change_password boolean NOT NULL DEFAULT false, password_changed_at timestamptz);
    CREATE TABLE public.tickets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, description text, priority text NOT NULL DEFAULT 'medium', type text,
      status public.ticket_status NOT NULL DEFAULT 'open', asset_id uuid, created_by uuid NOT NULL REFERENCES public.profiles(id), assigned_to uuid REFERENCES public.profiles(id),
      ticket_number text UNIQUE, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), resolved_at timestamptz, closed_at timestamptz,
      on_hold_at timestamptz, total_hold_seconds integer NOT NULL DEFAULT 0, last_activity_at timestamptz, satisfaction_rating smallint CHECK(satisfaction_rating >= 1 AND satisfaction_rating <= 5), satisfaction_comment text
    );
    CREATE TABLE public.assets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL DEFAULT 'active', assigned_to uuid REFERENCES public.profiles(id), last_pm_date date, next_pm_date date, pm_required boolean NOT NULL DEFAULT true);
    CREATE TABLE public.asset_history (id uuid DEFAULT gen_random_uuid(), asset_id uuid NOT NULL REFERENCES public.assets(id), action text NOT NULL, changed_by uuid REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now());
    ${functionSql(initial, 'get_my_role')}
    ${functionSql(initial, 'is_active_user')}
    ${functionSql(hardening, 'guard_profile_update')}
    ${functionSql(hardening, 'guard_ticket_update')}
    ${functionSql(pmGuard, 'validate_asset_pm_dates')}
    CREATE TRIGGER trg_guard_profile_update BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_update();
    CREATE TRIGGER trg_guard_ticket_update BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION guard_ticket_update();
    CREATE TRIGGER validate_asset_pm_dates BEFORE INSERT OR UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION validate_asset_pm_dates();
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE tickets ENABLE ROW LEVEL SECURITY; ALTER TABLE assets ENABLE ROW LEVEL SECURITY; ALTER TABLE asset_history ENABLE ROW LEVEL SECURITY;
    ${policySql(hardening, 'profiles_select_authenticated')}
    ${policySql(hardening, 'profiles_update_self_or_admin')}
    ${policySql(readAll, 'tickets_select_scoped')}
    ${policySql(hardening, 'tickets_insert_authenticated')}
    ${policySql(hardening, 'tickets_update_scoped')}
    ${policySql(hardening, 'assets_select_authenticated')}
    ${policySql(hardening, 'assets_insert_staff')}
    ${policySql(hardening, 'assets_update_staff')}
    ${policySql(hardening, 'asset_history_select_authenticated')}
    ${policySql(hardening, 'asset_history_insert_staff')}
    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT SELECT,INSERT,UPDATE ON profiles,tickets,assets,asset_history TO authenticated;
    INSERT INTO profiles(id,role,is_active,must_change_password) VALUES
      ('${general}','general_user',true,true),('${other}','general_user',true,false),('${support}','support_staff',true,false),('${inactive}','general_user',false,false);
    INSERT INTO tickets(id,title,created_by,status) VALUES ('10000000-0000-4000-8000-000000000001','own','${general}','open'),('10000000-0000-4000-8000-000000000002','other','${other}','open');
  `);
}, 30000);
afterAll(async () => { if (db) await db.close(); });
async function asUser(id: string) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE authenticated;`);
}

describe('isolated authorization characterization', () => {
  it('permits organization reads but blocks other-ticket and core-field changes', async () => {
    await asUser(general);
    expect((await db.query('SELECT id FROM tickets')).rows).toHaveLength(2);
    expect((await db.query("UPDATE tickets SET title='Changed' WHERE created_by=$1 RETURNING id", [other])).rows).toHaveLength(0);
    await expect(db.query("UPDATE tickets SET title='Changed' WHERE created_by=$1", [general])).rejects.toThrow(/cannot modify core/);
  });
  it('characterizes general-user ability to alter own timing fields and create non-open tickets', async () => {
    await asUser(general);
    const update = await db.query("UPDATE tickets SET created_at='2020-01-01', resolved_at='2020-01-02', total_hold_seconds=3600 WHERE created_by=$1 RETURNING created_at,resolved_at,total_hold_seconds", [general]);
    expect(update.rows).toHaveLength(1);
    const inserted = await db.query("INSERT INTO tickets(title,created_by,status,assigned_to,resolved_at,satisfaction_rating) VALUES ('synthetic',$1,'resolved',$2,now(),5) RETURNING status,satisfaction_rating", [general, support]);
    expect(inserted.rows).toEqual([{ status: 'resolved', satisfaction_rating: 5 }]);
  });
  it('characterizes clearing the mandatory-password flag without an Auth password update', async () => {
    await asUser(general);
    const result = await db.query('UPDATE profiles SET must_change_password=false WHERE id=$1 RETURNING must_change_password', [general]);
    expect(result.rows).toEqual([{ must_change_password: false }]);
  });
  it('blocks support changes to existing asset status but permits initial status and assignment on insert', async () => {
    await asUser(support);
    const row = await db.query("INSERT INTO assets(status,assigned_to,next_pm_date) VALUES ('retired',$1,'2099-01-01') RETURNING id,status,assigned_to", [general]);
    expect(row.rows[0]).toMatchObject({ status: 'retired', assigned_to: general });
    await expect(db.query("UPDATE assets SET status='active' WHERE id=$1", [(row.rows[0] as { id: string }).id])).rejects.toThrow(/Only administrators/);
  });
  it('characterizes unrestricted staff ticket transitions and spoofable history authorship', async () => {
    await asUser(support);
    const updated = await db.query("UPDATE tickets SET status='closed' WHERE created_by=$1 RETURNING status", [general]);
    expect(updated.rows).toEqual([{ status: 'closed' }, { status: 'closed' }]);
    const reopened = await db.query("UPDATE tickets SET status='open' WHERE created_by=$1 RETURNING status", [general]);
    expect(reopened.rows).toEqual([{ status: 'open' }, { status: 'open' }]);
    const assets = await db.query('SELECT id FROM assets LIMIT 1');
    const history = await db.query("INSERT INTO asset_history(asset_id,action,changed_by) VALUES ($1,'synthetic event',$2) RETURNING changed_by", [(assets.rows[0] as { id: string }).id, other]);
    expect(history.rows).toEqual([{ changed_by: other }]);
  });
  it('does not expose tickets to an inactive profile', async () => {
    await asUser(inactive);
    expect((await db.query('SELECT id FROM tickets')).rows).toHaveLength(0);
    await expect(db.query("INSERT INTO tickets(title,created_by) VALUES ('Denied',$1)", [inactive])).rejects.toThrow(/row-level security/);
  });
  it('characterizes SLA notification duplication and missed reassignment alerts', async () => {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);
      CREATE TABLE public.notifications(id uuid DEFAULT gen_random_uuid(), user_id uuid, type text, title text, body text, link text);
      CREATE FUNCTION public.sla_hours(priority text) RETURNS numeric LANGUAGE sql AS $$ SELECT 4::numeric $$;
      ${functionSql(initial, 'notify_sla_at_risk')}
      INSERT INTO tickets(id,title,created_by,assigned_to,status,created_at) VALUES
       ('20000000-0000-4000-8000-000000000001','Synthetic alert','${support}','${support}','in_progress',now()-interval '3 hours');
      SELECT public.notify_sla_at_risk();
    `);
    const alertLink = '/tickets/20000000-0000-4000-8000-000000000001';
    const first = await db.query('SELECT user_id FROM notifications WHERE link=$1', [alertLink]);
    expect(first.rows).toEqual([{ user_id: support }, { user_id: support }]);
    await db.exec(`UPDATE tickets SET assigned_to='${other}' WHERE id='20000000-0000-4000-8000-000000000001'; SELECT public.notify_sla_at_risk();`);
    const later = await db.query('SELECT user_id FROM notifications WHERE link=$1', [alertLink]);
    expect(later.rows).toHaveLength(2);
    expect(later.rows.some((r: any) => r.user_id === other)).toBe(false);
  });

});
