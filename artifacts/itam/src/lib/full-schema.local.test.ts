import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'node:fs';

const migrationsDir = new URL('../../../../supabase/migrations/', import.meta.url);
const script = (name: string) => readFileSync(new URL(name, migrationsDir), 'utf8');
const admin = '00000000-0000-4000-8000-000000000001';
const general = '00000000-0000-4000-8000-000000000002';
const support = '00000000-0000-4000-8000-000000000003';
const second = '00000000-0000-4000-8000-000000000004';
let db: PGlite;
async function asUser(id: string) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE authenticated;`);
}

// Synthetic local PostgreSQL, no network or pilot records. Auth, cron and
// publication are explicit shims: no GoTrue, API gateway, Realtime or jobs run.
// Applies actual repository migrations in order rather than extracting guards.
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
  const files = readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort();
  for (const name of files) {
    // PGlite cannot run pg_cron; the cron API above stores definitions only.
    const sql = script(name).replace('CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;', '-- pg_cron is replaced by an inert local test shim');
    try { await db.exec(sql); } catch (error) { throw new Error(`Migration ${name} failed`, { cause: error }); }
  }
  await db.exec(`
    INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
      ('${admin}','admin@example.test','{"full_name":"Admin"}'),
      ('${general}','user@example.test','{"full_name":"User"}'),
      ('${support}','support@example.test','{"full_name":"Support"}'),
      ('${second}','other@example.test','{"full_name":"Other"}');
    UPDATE profiles SET role='administrator' WHERE id='${admin}';
    UPDATE profiles SET role='support_staff' WHERE id='${support}';
  `);
}, 30000);
afterAll(async () => { if (db) await db.close(); });

describe('full repository migrations in isolated PostgreSQL', () => {
  it('general user creates only open unassigned tickets, not forged lifecycle data', async () => {
    await asUser(general);
    const result = await db.query("INSERT INTO tickets(title,created_by) VALUES ('Synthetic',$1) RETURNING id,status,ticket_number", [general]);
    expect(result.rows[0]).toMatchObject({ status: 'open' });
    expect((result.rows[0] as { ticket_number: string }).ticket_number).toMatch(/^DOST02-ITS\d{9}$/);
    await expect(db.query("INSERT INTO tickets(title,created_by,status) VALUES ('Synthetic',$1,'closed')", [general])).rejects.toThrow(/open and unassigned/);
  });
  it('maintains creator feedback, comment activity and retained assignment', async () => {
    await asUser(support);
    const result = await db.query("INSERT INTO tickets(title,created_by,assigned_to,status,resolved_at) VALUES ('Resolved',$1,$2,'resolved',now()-interval '1 hour') RETURNING id", [general, support]);
    const id = (result.rows[0] as { id: string }).id;
    await asUser(general);
    await expect(db.query("UPDATE tickets SET total_hold_seconds=999 WHERE id=$1", [id])).rejects.toThrow(/Forbidden/);
    const closed = await db.query("UPDATE tickets SET status='closed',closed_at='2099-01-01' WHERE id=$1 RETURNING status,assigned_to,closed_at=now() AS server_closed", [id]);
    expect(closed.rows).toEqual([{ status: 'closed', assigned_to: support, server_closed: true }]);
    expect((await db.query("UPDATE tickets SET satisfaction_rating=5 WHERE id=$1 RETURNING satisfaction_rating", [id])).rows).toEqual([{ satisfaction_rating: 5 }]);
    expect((await db.query("INSERT INTO ticket_comments(ticket_id,created_by,comment_text) VALUES ($1,$2,'Synthetic comment') RETURNING ticket_id", [id, general])).rows).toEqual([{ ticket_id: id }]);
  });
  it('enforces support asset status and still permits audited maintenance', async () => {
    await asUser(admin);
    const rows = await db.query("INSERT INTO assets(asset_tag,name,category,status,assigned_to,next_pm_date) VALUES ('LOCAL-1','Synthetic','laptop','active',$1,'2099-01-01') RETURNING id", [general]);
    const id = (rows.rows[0] as { id: string }).id;
    await asUser(support);
    await expect(db.query("INSERT INTO assets(asset_tag,name,category,status,next_pm_date) VALUES ('LOCAL-2','Denied','laptop','retired','2099-01-01')")).rejects.toThrow(/Only administrators/);
    const work = await db.query("SELECT public.record_asset_maintenance($1,'corrective',CURRENT_DATE,$2,'Synthetic repair',NULL,'00000000-0000-4000-8000-000000000099') AS id", [id, support]);
    expect(work.rows[0]).toHaveProperty('id');
    const asset = await db.query('SELECT status,assigned_to FROM assets WHERE id=$1', [id]);
    expect(asset.rows).toEqual([{ status: 'active', assigned_to: general }]);
  });
  it('preserves preventive PM transaction, idempotency and explicit return to service', async () => {
    await asUser(admin);
    const result = await db.query("INSERT INTO assets(asset_tag,name,category,status,assigned_to,next_pm_date) VALUES ('LOCAL-PM','Synthetic','laptop','active',$1,'2099-01-01') RETURNING id", [general]);
    const id = (result.rows[0] as { id: string }).id;
    await db.query("UPDATE assets SET status='maintenance',assigned_to=NULL WHERE id=$1", [id]);
    expect((await db.query('SELECT status,assigned_to FROM assets WHERE id=$1', [id])).rows).toEqual([{ status: 'maintenance', assigned_to: general }]);
    await asUser(support);
    const requestId = '00000000-0000-4000-8000-000000000098';
    const sql = "SELECT public.record_asset_maintenance($1,'preventive',CURRENT_DATE,$2,'Synthetic PM',(CURRENT_DATE + interval '6 months')::date,$3) AS id";
    const first = await db.query(sql, [id, support, requestId]);
    expect(await db.query(sql, [id, support, requestId])).toEqual(first);
    expect((await db.query('SELECT id FROM asset_maintenance_log WHERE asset_id=$1', [id])).rows).toHaveLength(1);
    expect((await db.query("SELECT id FROM asset_history WHERE asset_id=$1 AND action IN ('pm_recorded','pm_scheduled')", [id])).rows).toHaveLength(2);
    await expect(db.query('UPDATE assets SET next_pm_date=CURRENT_DATE+30 WHERE id=$1', [id])).rejects.toThrow(/audited PM/);
    await expect(db.query('SELECT public.return_asset_to_service($1)', [id])).rejects.toThrow(/administrator/i);
    await asUser(general);
    await expect(db.query("SELECT public.record_asset_maintenance($1,'corrective',CURRENT_DATE,$2,'Denied',NULL,'00000000-0000-4000-8000-000000000097')", [id, support])).rejects.toThrow(/Only active administrators/);
    await asUser(admin);
    await db.query('SELECT public.return_asset_to_service($1)', [id]);
    expect((await db.query('SELECT status,assigned_to FROM assets WHERE id=$1', [id])).rows).toEqual([{ status: 'active', assigned_to: general }]);
  });
  it('still denies unauthorized ticket edits across users', async () => {
    await asUser(second);
    expect((await db.query("SELECT id FROM tickets")).rows.length).toBeGreaterThan(0);
    expect((await db.query("UPDATE tickets SET title='Denied' WHERE created_by=$1 RETURNING id", [general])).rows).toHaveLength(0);
  });
  it('rollback restores the old function definitions in the full synthetic schema', async () => {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
    await db.exec(readFileSync(new URL('../../../../supabase/rollbacks/20261101000014_ticket_and_asset_write_guards.sql', import.meta.url), 'utf8'));
    expect((await db.query("SELECT tgname FROM pg_trigger WHERE tgname='a_guard_ticket_insert' AND NOT tgisinternal")).rows).toHaveLength(0);
    await asUser(general);
    const row = await db.query("INSERT INTO tickets(title,created_by,status,resolved_at) VALUES ('Rollback characterization',$1,'resolved',now()) RETURNING status", [general]);
    expect(row.rows).toEqual([{ status: 'resolved' }]); // Rollback reopens this vulnerability.
  });

});
