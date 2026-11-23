import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'node:fs';

// Password gate Phase 3 step 3.0 (grant cleanup), tested in a synthetic local
// PostgreSQL. Not GoTrue, PostgREST or live Supabase. It checks privileges,
// behaviour under the authenticated role, and an exact rollback.
//
// Repo migrations do not produce the live ACL. Live tables carry Supabase
// default privileges (TRUNCATE, REFERENCES, TRIGGER, and anon on admin_audit_log).
// The drift below copies the read-only catalog output of 2026-11-23.

const migrationsDir = new URL('../../../../supabase/migrations/', import.meta.url);
const proposalsDir = new URL('../../../../supabase/proposals/password-gate/', import.meta.url);
const script = (name: string) => readFileSync(new URL(name, migrationsDir), 'utf8');
const proposal = (name: string) => readFileSync(new URL(name, proposalsDir), 'utf8');

const admin = '00000000-0000-4000-8000-000000000001';
const general = '00000000-0000-4000-8000-000000000002';
const support = '00000000-0000-4000-8000-000000000003';

let db: PGlite;
let preCleanup = '';

async function asUser(id: string) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE authenticated;`);
}
async function asPostgres() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);`);
}

// Canonical, order-independent snapshot of public relation and default ACLs.
async function aclState(): Promise<string> {
  const rel = await db.query<{ k: string }>(`
    SELECT c.relname || '|' || COALESCE(g.rolname,'PUBLIC') || '|' || a.privilege_type || '|' || a.is_grantable::text AS k
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    LEFT JOIN pg_roles g ON g.oid = a.grantee
    WHERE c.relkind IN ('r','p','v','m','f')
    ORDER BY 1`);
  const def = await db.query<{ k: string }>(`
    SELECT 'default|' || COALESCE(g.rolname,'PUBLIC') || '|' || a.privilege_type || '|' || a.is_grantable::text AS k
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace AND n.nspname = 'public'
    JOIN pg_roles r ON r.oid = d.defaclrole AND r.rolname = 'postgres'
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    LEFT JOIN pg_roles g ON g.oid = a.grantee
    WHERE d.defaclobjtype = 'r'
    ORDER BY 1`);
  const col = await db.query<{ k: string }>(`
    SELECT 'column|' || c.relname || '|' || attr.attname || '|' || COALESCE(g.rolname,'PUBLIC') || '|' || a.privilege_type || '|' || a.is_grantable::text AS k
    FROM pg_attribute attr
    JOIN pg_class c ON c.oid = attr.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    CROSS JOIN LATERAL aclexplode(attr.attacl) a
    LEFT JOIN pg_roles g ON g.oid = a.grantee
    WHERE attr.attnum > 0 AND attr.attacl IS NOT NULL
    ORDER BY 1`);
  return JSON.stringify([...rel.rows.map(r => r.k), ...def.rows.map(r => r.k), ...col.rows.map(r => r.k)]);
}

async function leftoverRisk(): Promise<string[]> {
  const r = await db.query<{ k: string }>(`
    SELECT c.relname || ':' || g.rolname || ':' || p AS k
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS gr(role)
    JOIN pg_roles g ON g.rolname = gr.role
    CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS pv(p)
    WHERE c.relkind IN ('r','p','v','m','f')
      AND has_table_privilege(g.oid, c.oid, pv.p)
    UNION ALL
    SELECT c.relname || '.' || attr.attname || ':' || g.rolname || ':REFERENCES(column)' AS k
    FROM pg_attribute attr
    JOIN pg_class c ON c.oid = attr.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS gr(role)
    JOIN pg_roles g ON g.rolname = gr.role
    WHERE attr.attnum > 0 AND c.relkind IN ('r','p','v','m','f')
      AND has_column_privilege(g.oid, c.oid, attr.attnum, 'REFERENCES')
    ORDER BY 1`);
  return r.rows.map(x => x.k);
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
      ('${general}','user@example.test','{"full_name":"User"}'),
      ('${support}','support@example.test','{"full_name":"Support"}');
    UPDATE profiles SET role='administrator' WHERE id='${admin}';
    UPDATE profiles SET role='support_staff' WHERE id='${support}';
  `);

  // Recreate the live drift (read-only catalog, 2026-11-23). Gate tables are left alone.
  await db.exec(`
    GRANT ALL ON public.assets, public.asset_history, public.asset_maintenance_log,
      public.categories, public.notifications, public.tickets, public.ticket_comments,
      public.admin_audit_log, public.profiles TO authenticated;
    REVOKE UPDATE ON public.profiles FROM authenticated;
    GRANT UPDATE (role, full_name, department, is_active) ON public.profiles TO authenticated;
    GRANT ALL ON public.admin_audit_log TO anon;
    GRANT ALL ON public.profiles_with_email TO authenticated;
    REVOKE REFERENCES ON public.tickets FROM authenticated;
    GRANT REFERENCES (title) ON public.tickets TO authenticated;
    GRANT ALL ON public.assets, public.asset_history, public.asset_maintenance_log,
      public.categories, public.notifications, public.tickets, public.ticket_comments,
      public.admin_audit_log, public.profiles, public.profiles_with_email TO service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      GRANT ALL ON TABLES TO anon, authenticated, service_role;
  `);
  preCleanup = await aclState();
}, 60000);
afterAll(async () => { if (db) await db.close(); });

describe('step 3.0 grant cleanup (local PostgreSQL, not live)', () => {
  it('starts from the live drift shape: TRUNCATE, REFERENCES and TRIGGER are present for anon/authenticated', async () => {
    const risks = await leftoverRisk();
    expect(risks).toContain('tickets:authenticated:TRUNCATE');
    expect(risks).toContain('tickets:authenticated:TRIGGER');
    expect(risks).toContain('admin_audit_log:anon:TRUNCATE');
    expect(risks).toContain('tickets.title:authenticated:REFERENCES(column)');
    const pu = await db.query<{ u: boolean }>("SELECT has_table_privilege('authenticated','public.profiles','UPDATE') AS u");
    expect(pu.rows[0].u).toBe(false);
  });

  it('applies the cleanup, leaving no TRUNCATE, REFERENCES or TRIGGER for anon or authenticated', async () => {
    await db.exec(proposal('grant-cleanup.sql'));
    expect(await leftoverRisk()).toEqual([]);
  });

  it('removes all anon privileges on admin_audit_log and keeps service_role intact', async () => {
    const r = await db.query<{ a: boolean; s: boolean; t: boolean }>(`
      SELECT has_table_privilege('anon','public.admin_audit_log','SELECT') AS a,
             has_table_privilege('anon','public.admin_audit_log','INSERT') AS s,
             has_table_privilege('anon','public.admin_audit_log','TRUNCATE') AS t`);
    expect(r.rows[0]).toEqual({ a: false, s: false, t: false });
    const svc = await db.query<{ t: boolean }>(`SELECT has_table_privilege('service_role','public.tickets','TRUNCATE') AS t`);
    expect(svc.rows[0].t).toBe(true);
  });

  it('keeps the view read-only for authenticated and removes its write grants', async () => {
    const r = await db.query<{ s: boolean; i: boolean; u: boolean; d: boolean }>(`
      SELECT has_table_privilege('authenticated','public.profiles_with_email','SELECT') AS s,
             has_table_privilege('authenticated','public.profiles_with_email','INSERT') AS i,
             has_table_privilege('authenticated','public.profiles_with_email','UPDATE') AS u,
             has_table_privilege('authenticated','public.profiles_with_email','DELETE') AS d`);
    expect(r.rows[0]).toEqual({ s: true, i: false, u: false, d: false });
  });

  it('keeps the app privileges the frontend uses, and the column-only profile update', async () => {
    const r = await db.query<{ t: boolean; i: boolean; u: boolean; d: boolean; pu: boolean; pfull: boolean }>(`
      SELECT has_table_privilege('authenticated','public.tickets','SELECT') AS t,
             has_table_privilege('authenticated','public.tickets','INSERT') AS i,
             has_table_privilege('authenticated','public.tickets','UPDATE') AS u,
             has_table_privilege('authenticated','public.tickets','DELETE') AS d,
             has_table_privilege('authenticated','public.profiles','UPDATE') AS pu,
             has_column_privilege('authenticated','public.profiles','full_name','UPDATE') AS pfull`);
    expect(r.rows[0]).toEqual({ t: true, i: true, u: true, d: true, pu: false, pfull: true });
  });

  it('new tables created after the cleanup do not regain the three privileges for anon or authenticated', async () => {
    await asPostgres();
    await db.exec('CREATE TABLE public.zz_grant_probe(id int);');
    const r = await db.query<{ k: string }>(`
      SELECT role || ':' || p AS k FROM (VALUES ('anon'),('authenticated')) AS g(role)
      CROSS JOIN (VALUES ('TRUNCATE'),('REFERENCES'),('TRIGGER')) AS pv(p)
      WHERE has_table_privilege(g.role, 'public.zz_grant_probe', pv.p)`);
    expect(r.rows).toEqual([]);
    await db.exec('DROP TABLE public.zz_grant_probe;');
  });

  it('keeps normal app writes working for a signed-in general user, so no trigger depended on the revoked grants', async () => {
    await asUser(general);
    const created = await db.query<{ id: string }>(
      "INSERT INTO tickets(title,created_by) VALUES ('Grant cleanup check',$1) RETURNING id", [general]);
    expect(created.rows).toHaveLength(1);
    await db.query("SELECT * FROM profiles_with_email WHERE id=$1", [general]);
    await db.query("UPDATE profiles SET full_name='User Renamed' WHERE id=$1", [general]);
    await asUser(admin);
    await db.query("UPDATE tickets SET description='updated by admin' WHERE id=$1", [created.rows[0].id]);
    await asPostgres();
  });

  it('denies TRUNCATE to a signed-in user, which is the point of the cleanup', async () => {
    await asUser(admin);
    await expect(db.exec('TRUNCATE public.tickets')).rejects.toThrow(/permission denied/);
    await expect(db.exec('TRUNCATE public.admin_audit_log')).rejects.toThrow(/permission denied/);
    await asPostgres();
  });

  it('denies anon every read and write on admin_audit_log', async () => {
    await db.exec('RESET ROLE; SET ROLE anon;');
    await expect(db.query('SELECT 1 FROM public.admin_audit_log')).rejects.toThrow(/permission denied/);
    await asPostgres();
  });

  it('rollback restores the exact pre-cleanup ACL, then re-applying reaches the same cleanup state', async () => {
    await asPostgres();
    const afterCleanup = await aclState();
    await db.exec(proposal('grant-cleanup-rollback.sql'));
    expect(await aclState()).toEqual(preCleanup);
    expect(await leftoverRisk()).toContain('tickets:authenticated:TRUNCATE');
    const snap = await db.query<{ t: string | null }>("SELECT to_regclass('private.grant_cleanup_snapshot')::text AS t");
    expect(snap.rows[0].t).toBeNull();

    await db.exec(proposal('grant-cleanup.sql'));
    expect(await aclState()).toEqual(afterCleanup);
    expect(await leftoverRisk()).toEqual([]);
  });

  it('refuses to roll back without a snapshot', async () => {
    await asPostgres();
    await db.exec('DELETE FROM private.grant_cleanup_snapshot;');
    await expect(db.exec(proposal('grant-cleanup-rollback.sql'))).rejects.toThrow(/no grant snapshot/);
  });
});
