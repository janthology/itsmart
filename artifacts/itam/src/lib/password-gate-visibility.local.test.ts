import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'node:fs';

// Visibility scope (migration 20261124060000): profiles, assets, asset history and maintenance log.
// Tickets stay as in migration 20261030000006. Applied after every repository migration on a local
// PostgreSQL in PGlite. Not GoTrue, PostgREST, Realtime or live Supabase.
const migrationsDir = new URL('../../../../supabase/migrations/', import.meta.url);
const rollbackFile = new URL('../../../../supabase/rollbacks/20261124060000_password_gate_visibility_scope.sql', import.meta.url);
const visibilityFile = '20261124060000_password_gate_visibility_scope.sql';
const proposalsDir = new URL('../../../../supabase/proposals/password-gate/', import.meta.url);
const proposal = (name: string) => readFileSync(new URL(name, proposalsDir), 'utf8');

const admin = '00000000-0000-4000-8000-0000000000a1';
const general = '00000000-0000-4000-8000-0000000000a2';
const support = '00000000-0000-4000-8000-0000000000a3';
const flagged = '00000000-0000-4000-8000-0000000000a4';
const gen = '00000000-0000-4000-8000-0000000000b1';
const sAdmin = '00000000-0000-4000-8000-0000000000c1';
const sGeneral = '00000000-0000-4000-8000-0000000000c2';
const sSupport = '00000000-0000-4000-8000-0000000000c3';
const sFlagged = '00000000-0000-4000-8000-0000000000c4';
const assetGeneral = '00000000-0000-4000-8000-0000000000d1';
const assetUnassigned = '00000000-0000-4000-8000-0000000000d2';
const assetSupport = '00000000-0000-4000-8000-0000000000d3';

let db: PGlite;

// Every row of a table, read as the database owner (bypasses row-level security).
async function allIds(table: string, idColumn = 'id'): Promise<string[]> {
  await asPostgres();
  const r = await db.query<Record<string, string>>(`SELECT ${idColumn} AS v FROM public.${table}`);
  return r.rows.map(row => row.v);
}

async function asPostgres() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claims','{}',false);`);
}
// A signed-in session with the broker's session_id claim.
async function asUser(sub: string, sessionId?: string) {
  await db.exec('RESET ROLE');
  const claims = JSON.stringify(sessionId ? { sub, session_id: sessionId } : { sub });
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)", [sub, claims]);
  await db.exec('SET ROLE authenticated');
}
async function asAnon() {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claims','{}',false); SET ROLE anon;`);
}
// Returns the visible row ids for a table, as the role set up before the call.
async function visibleIds(table: string, idColumn = 'id'): Promise<string[]> {
  const r = await db.query<Record<string, string>>(`SELECT ${idColumn} AS v FROM public.${table}`);
  return r.rows.map(row => row.v);
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
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
  // Test accounts. Profiles are created by the repository's auth trigger.
  await db.exec(`
    INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
      ('${admin}','admin@example.test','{"full_name":"Admin"}'),
      ('${general}','user@example.test','{"full_name":"User"}'),
      ('${support}','support@example.test','{"full_name":"Support"}'),
      ('${flagged}','flagged@example.test','{"full_name":"Flagged"}');
    UPDATE profiles SET role='administrator' WHERE id='${admin}';
    UPDATE profiles SET role='support_staff' WHERE id='${support}';
  `);
  // The gate as it is in production: the same proposal files, in the same order, as the step 3.3 test.
  await db.exec(proposal('grant-cleanup.sql'));
  await db.exec(proposal('grant-cleanup-addendum.sql'));
  await db.exec(proposal('schema-step31.sql'));
  await db.exec(`
    INSERT INTO public.password_gate_state(user_id,phase,operation_id,updated_at) VALUES
      ('${admin}','cleared','${gen}',clock_timestamp()),
      ('${general}','cleared','${gen}',clock_timestamp()),
      ('${support}','cleared','${gen}',clock_timestamp()),
      ('${flagged}','required','${gen}',clock_timestamp());
    INSERT INTO auth.sessions(id,user_id) VALUES
      ('${sAdmin}','${admin}'),('${sGeneral}','${general}'),('${sSupport}','${support}'),('${sFlagged}','${flagged}');
    INSERT INTO public.password_gate_admitted_sessions(session_id,user_id,generation,scope) VALUES
      ('${sAdmin}','${admin}','${gen}','full'),('${sGeneral}','${general}','${gen}','full'),('${sSupport}','${support}','${gen}','full');
    INSERT INTO assets(id,asset_tag,name,category,assigned_to,next_pm_date) VALUES
      ('${assetGeneral}','V-GEN','Assigned to general',(enum_range(NULL::public.asset_category_type))[1],'${general}','2099-01-01'),
      ('${assetUnassigned}','V-NONE','Unassigned',(enum_range(NULL::public.asset_category_type))[1],NULL,'2099-02-01'),
      ('${assetSupport}','V-SUP','Assigned to support',(enum_range(NULL::public.asset_category_type))[1],'${support}','2099-03-01');
    INSERT INTO asset_history(asset_id,action) VALUES ('${assetGeneral}','assigned'),('${assetUnassigned}','registered'),('${assetSupport}','assigned');
    INSERT INTO asset_maintenance_log(asset_id,performed_at) VALUES ('${assetGeneral}',now()),('${assetUnassigned}',now()),('${assetSupport}',now());
    INSERT INTO tickets(title,created_by,status) VALUES ('ticket by general','${general}','open'),('ticket by admin','${admin}','open');
  `);
  // Restrictive gate policies and helpers, then enforce mode (production is in enforce).
  await db.exec(proposal('enforcement-step33.sql'));
  await db.exec(`UPDATE public.password_gate_settings SET mode = 'enforce', updated_at = clock_timestamp() WHERE id = 1`);
}, 120000);
afterAll(async () => { if (db) await db.close(); });

describe('profiles (visibility scope, local)', () => {
  it('administrator sees all profiles', async () => {
    await asUser(admin, sAdmin);
    expect((await visibleIds('profiles')).sort()).toEqual((await allIds('profiles')).sort());
  });
  it('general user sees only their own profile', async () => {
    await asUser(general, sGeneral);
    expect(await visibleIds('profiles')).toEqual([general]);
  });
  it('support staff sees only their own profile', async () => {
    await asUser(support, sSupport);
    expect(await visibleIds('profiles')).toEqual([support]);
  });
  it('flagged (restricted) session sees only its own profile', async () => {
    await asUser(flagged, sFlagged);
    expect(await visibleIds('profiles')).toEqual([flagged]);
  });
  it('anon has no read access to profiles', async () => {
    await asAnon();
    await expect(visibleIds('profiles')).rejects.toThrow(/permission denied/);
  });
});

describe('assets (visibility scope, local)', () => {
  it('administrator and support staff see all assets', async () => {
    await asUser(admin, sAdmin);
    expect((await visibleIds('assets')).sort()).toEqual([assetGeneral, assetUnassigned, assetSupport].sort());
    await asUser(support, sSupport);
    expect((await visibleIds('assets')).sort()).toEqual([assetGeneral, assetUnassigned, assetSupport].sort());
  });
  it('general user sees only assets assigned to them', async () => {
    await asUser(general, sGeneral);
    expect(await visibleIds('assets')).toEqual([assetGeneral]);
  });
  it('flagged (restricted) session sees no assets', async () => {
    await asUser(flagged, sFlagged);
    expect(await visibleIds('assets')).toEqual([]);
  });
});

describe('asset history and maintenance log follow the asset (visibility scope, local)', () => {
  it('general user sees history and maintenance only for their own asset', async () => {
    await asUser(general, sGeneral);
    expect(await visibleIds('asset_history', 'asset_id')).toEqual([assetGeneral]);
    expect(await visibleIds('asset_maintenance_log', 'asset_id')).toEqual([assetGeneral]);
  });
  it('administrator sees all history and maintenance', async () => {
    await asUser(admin, sAdmin);
    expect(await visibleIds('asset_history', 'asset_id')).toHaveLength(3);
    expect(await visibleIds('asset_maintenance_log', 'asset_id')).toHaveLength(3);
  });
});

describe('tickets are unchanged (migration 20261030000006)', () => {
  it('general user sees all tickets; flagged session sees none', async () => {
    await asUser(general, sGeneral);
    expect((await visibleIds('tickets')).sort()).toEqual((await allIds('tickets')).sort());
    await asUser(flagged, sFlagged);
    expect(await visibleIds('tickets')).toEqual([]);
  });
});

describe('rollback restores the previous permissive policies (local)', () => {
  it('general user sees all assets and all profiles after rollback, and the migration restores the scope', async () => {
    await asPostgres();
    await db.exec(readFileSync(rollbackFile, 'utf8'));
    await asUser(general, sGeneral);
    expect(await visibleIds('assets')).toHaveLength(3);
    expect((await visibleIds('profiles')).sort()).toEqual((await allIds('profiles')).sort());
    await asPostgres();
    const sql = readFileSync(new URL(visibilityFile, migrationsDir), 'utf8');
    await db.exec(sql);
    await asUser(general, sGeneral);
    expect(await visibleIds('assets')).toEqual([assetGeneral]);
    expect(await visibleIds('profiles')).toEqual([general]);
  });
});
