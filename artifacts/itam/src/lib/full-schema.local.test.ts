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
  it('restricts direct history authorship while retaining staff and maintenance paths', async () => {
    await asUser(admin);
    const asset = await db.query("INSERT INTO assets(asset_tag,name,category,pm_required) VALUES ('LOCAL-ACTOR','Synthetic','laptop',false) RETURNING id");
    const id = (asset.rows[0] as { id: string }).id;
    const insert = "INSERT INTO asset_history(asset_id,action,changed_by) VALUES ($1,'field_updated',$2) RETURNING changed_by";
    expect((await db.query(insert, [id, admin])).rows).toEqual([{ changed_by: admin }]);
    await expect(db.query(insert, [id, support])).rejects.toThrow(/row-level security/);
    await asUser(support);
    expect((await db.query(insert, [id, support])).rows).toEqual([{ changed_by: support }]);
    await expect(db.query(insert, [id, admin])).rejects.toThrow(/row-level security/);
    await expect(db.query(insert, [id, null])).rejects.toThrow(/row-level security/);
    await asUser(general);
    await expect(db.query(insert, [id, general])).rejects.toThrow(/row-level security/);
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
    await db.query("UPDATE profiles SET is_active=false WHERE id=$1", [second]);
    await asUser(second);
    await expect(db.query(insert, [id, second])).rejects.toThrow(/row-level security/);
    // A service-role operation remains outside this authenticated-user policy.
    await db.exec("RESET ROLE; SET ROLE service_role;");
    expect((await db.query(insert, [id, null])).rows).toEqual([{ changed_by: null }]);
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
    await db.query("UPDATE profiles SET is_active=true WHERE id=$1", [second]);
  });
  it('history-policy rollback reopens spoofing, and reapplying the guard closes it', async () => {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
    await db.exec(readFileSync(new URL('../../../../supabase/rollbacks/20261101000015_asset_history_actor_guard.sql', import.meta.url), 'utf8'));
    await asUser(support);
    const asset = await db.query("SELECT id FROM assets WHERE asset_tag='LOCAL-ACTOR'");
    const id = (asset.rows[0] as { id: string }).id;
    const insert = "INSERT INTO asset_history(asset_id,action,changed_by) VALUES ($1,'field_updated',$2) RETURNING changed_by";
    expect((await db.query(insert, [id, admin])).rows).toEqual([{ changed_by: admin }]);
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
    await db.exec(script('20261101000015_asset_history_actor_guard.sql'));
    await asUser(support);
    await expect(db.query(insert, [id, admin])).rejects.toThrow(/row-level security/);
  });
  it('deduplicates SLA delivery per ticket, stage and recipient even after deletion or reopen', async () => {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
    const ticket = await db.query("INSERT INTO tickets(title,created_by,assigned_to,priority,status,created_at) VALUES ('LOCAL-SLA',$1,$1,'critical','in_progress',now()-interval '3 hours 10 minutes') RETURNING id", [support]);
    const id = (ticket.rows[0] as { id: string }).id;
    const link = `/tickets/${id}`;
    const recipients = async (type: string) => (await db.query<{ user_id: string }>('SELECT user_id FROM notifications WHERE link=$1 AND type=$2 ORDER BY user_id', [link, type])).rows.map(row => row.user_id);
    await db.exec('SELECT public.notify_sla_at_risk(); SELECT public.notify_sla_at_risk();');
    expect(await recipients('sla_at_risk')).toEqual([support]); // requester and assignee are the same
    await db.query('UPDATE tickets SET assigned_to=$2 WHERE id=$1', [id, general]);
    await db.exec('SELECT public.notify_sla_at_risk();');
    expect(await recipients('sla_at_risk')).toEqual([general, support].sort());
    await db.query("DELETE FROM notifications WHERE link=$1 AND type='sla_at_risk'", [link]);
    await db.query("UPDATE tickets SET status='resolved' WHERE id=$1", [id]);
    await db.query("UPDATE tickets SET status='in_progress' WHERE id=$1", [id]);
    await db.exec('SELECT public.notify_sla_at_risk();');
    expect(await recipients('sla_at_risk')).toEqual([]); // the durable ledger survives deletion/reopen
    await db.query("UPDATE tickets SET created_at=now()-interval '5 hours' WHERE id=$1", [id]);
    await db.exec('SELECT public.notify_sla_breached(); SELECT public.notify_sla_breached();');
    expect(await recipients('sla_breached')).toEqual([general, support].sort());
    await asUser(support);
    await expect(db.query('SELECT * FROM sla_notification_deliveries')).rejects.toThrow(/permission denied/);
    await expect(db.query('SELECT public.notify_sla_at_risk()')).rejects.toThrow(/permission denied/);
  });
  it('seeds existing alerts, preserves holds, and rolls back the ledger if notification insertion fails', async () => {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
    const risk = await db.query("INSERT INTO tickets(title,created_by,priority,status,created_at) VALUES ('LOCAL-SLA-SEED',$1,'critical','in_progress',now()-interval '3 hours 10 minutes') RETURNING id", [second]);
    const id = (risk.rows[0] as { id: string }).id;
    const link = `/tickets/${id}`;
    await db.query("INSERT INTO notifications(user_id,type,title,link) VALUES ($1,'sla_at_risk','Existing',$2)", [second, link]);
    await db.exec(script('20261101000017_sla_recipient_dedup.sql')); // seed currently present notifications
    await db.exec('SELECT public.notify_sla_at_risk();');
    expect((await db.query("SELECT id FROM notifications WHERE link=$1 AND type='sla_at_risk'", [link])).rows).toHaveLength(1);
    const held = await db.query("INSERT INTO tickets(title,created_by,priority,status,created_at) VALUES ('LOCAL-SLA-HOLD',$1,'critical','on_hold',now()-interval '5 hours') RETURNING id", [second]);
    await db.exec('SELECT public.notify_sla_breached();');
    expect((await db.query("SELECT ticket_id FROM sla_notification_deliveries WHERE ticket_id=$1", [(held.rows[0] as { id: string }).id])).rows).toHaveLength(0);
    const fail = await db.query("INSERT INTO tickets(title,created_by,priority,status,created_at) VALUES ('LOCAL-SLA-FAIL',$1,'critical','in_progress',now()-interval '3 hours 10 minutes') RETURNING id", [second]);
    const failId = (fail.rows[0] as { id: string }).id;
    await db.exec("ALTER TABLE notifications ADD CONSTRAINT local_reject_risk CHECK (type <> 'sla_at_risk') NOT VALID");
    await expect(db.exec('SELECT public.notify_sla_at_risk()')).rejects.toThrow(/local_reject_risk/);
    expect((await db.query('SELECT ticket_id FROM sla_notification_deliveries WHERE ticket_id=$1', [failId])).rows).toHaveLength(0);
    await db.exec('ALTER TABLE notifications DROP CONSTRAINT local_reject_risk; SELECT public.notify_sla_at_risk();');
    expect((await db.query('SELECT ticket_id FROM sla_notification_deliveries WHERE ticket_id=$1', [failId])).rows).toHaveLength(1);
  });
  it('creates an asset and its actor-derived history atomically with retry deduplication', async () => {
    await asUser(admin);
    await db.query("INSERT INTO assets(asset_tag,name,category,pm_required) VALUES ('DOST02-ITA' || to_char(now() AT TIME ZONE 'Asia/Manila','YYYY') || '000999','Existing','laptop',false)");
    const requestId = '40000000-0000-4000-8000-000000000001';
    const payload = JSON.stringify({ name: 'LOCAL-ATOMIC', category: 'laptop', status: 'active', pm_required: false });
    const sql = 'SELECT (public.create_asset_with_history($1,$2::jsonb)).id AS id';
    const first = await db.query<{ id: string }>(sql, [requestId, payload]);
    expect(await db.query(sql, [requestId, payload])).toEqual(first);
    const asset = await db.query<{ asset_tag: string }>('SELECT asset_tag FROM assets WHERE id=$1', [first.rows[0].id]);
    expect(asset.rows[0].asset_tag).toMatch(/^DOST02-ITA\d{4}001000$/);
    expect((await db.query("SELECT changed_by FROM asset_history WHERE asset_id=$1 AND action='created'", [first.rows[0].id])).rows).toEqual([{ changed_by: admin }]);
    await expect(db.query(sql, [requestId, JSON.stringify({ name: 'Changed', category: 'laptop', pm_required: false })])).rejects.toThrow(/different asset data/);
    await expect(db.query('SELECT * FROM asset_creation_requests')).rejects.toThrow(/permission denied/);
    await asUser(support);
    const supportAsset = await db.query<{ id: string }>(sql, ['40000000-0000-4000-8000-000000000002', payload]);
    expect((await db.query("SELECT changed_by FROM asset_history WHERE asset_id=$1 AND action='created'", [supportAsset.rows[0].id])).rows).toEqual([{ changed_by: support }]);
    await expect(db.query(sql, ['40000000-0000-4000-8000-000000000003', JSON.stringify({ name: 'Denied', category: 'laptop', status: 'retired', pm_required: false })])).rejects.toThrow(/Only administrators/);
    await asUser(general);
    await expect(db.query(sql, ['40000000-0000-4000-8000-000000000004', payload])).rejects.toThrow(/Only active administrators/);
  });
  it('rolls back asset creation, counter and request when creation history fails', async () => {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); ALTER TABLE asset_history ADD CONSTRAINT local_reject_created CHECK (action <> 'created') NOT VALID;");
    const before = await db.query('SELECT * FROM asset_tag_counters');
    await asUser(admin);
    const requestId = '40000000-0000-4000-8000-000000000005';
    await expect(db.query('SELECT public.create_asset_with_history($1,$2::jsonb)', [requestId, JSON.stringify({ name: 'LOCAL-FAIL', category: 'laptop', pm_required: false })])).rejects.toThrow(/local_reject_created/);
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); ALTER TABLE asset_history DROP CONSTRAINT local_reject_created;");
    expect(await db.query('SELECT * FROM asset_tag_counters')).toEqual(before);
    expect((await db.query('SELECT id FROM assets WHERE name=$1', ['LOCAL-FAIL'])).rows).toHaveLength(0);
    expect((await db.query('SELECT request_id FROM asset_creation_requests WHERE request_id=$1', [requestId])).rows).toHaveLength(0);
  });
  it('allocates above existing manual numbers and retains its high-water mark after deletion', async () => {
    await asUser(admin);
    const manual = await db.query("INSERT INTO tickets(title,created_by,ticket_number) VALUES ('LOCAL-ALLOC-MANUAL',$1,'DOST02-ITS' || to_char(now(),'YYYY') || '99999') RETURNING id", [admin]);
    const generated = await db.query("INSERT INTO tickets(title,created_by) VALUES ('LOCAL-ALLOC-ONE',$1) RETURNING id,ticket_number", [admin]);
    expect((generated.rows[0] as { ticket_number: string }).ticket_number).toMatch(/^DOST02-ITS\d{4}100000$/);
    await db.query('DELETE FROM tickets WHERE id=$1 OR id=$2', [(manual.rows[0] as { id: string }).id, (generated.rows[0] as { id: string }).id]);
    const next = await db.query("INSERT INTO tickets(title,created_by) VALUES ('LOCAL-ALLOC-TWO',$1) RETURNING id,ticket_number", [admin]);
    expect((next.rows[0] as { ticket_number: string }).ticket_number).toMatch(/^DOST02-ITS\d{4}100001$/);
    await expect(db.query('SELECT * FROM public.ticket_number_counters')).rejects.toThrow(/permission denied/);
    await expect(db.query('UPDATE public.ticket_number_counters SET last_issued=1')).rejects.toThrow(/permission denied/);
    await db.query('DELETE FROM tickets WHERE id=$1', [(next.rows[0] as { id: string }).id]);
    await asUser(general);
    const ordinary = await db.query("INSERT INTO tickets(title,created_by) VALUES ('LOCAL-ALLOC-GENERAL',$1) RETURNING ticket_number", [general]);
    expect((ordinary.rows[0] as { ticket_number: string }).ticket_number).toMatch(/^DOST02-ITS\d{4}100002$/);
    await asUser(admin);
    await db.query("DELETE FROM tickets WHERE title='LOCAL-ALLOC-GENERAL'");
  });
  it('rollback restores the old function definitions in the full synthetic schema', async () => {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
    await db.exec(readFileSync(new URL('../../../../supabase/rollbacks/20261101000014_ticket_and_asset_write_guards.sql', import.meta.url), 'utf8'));
    expect((await db.query("SELECT tgname FROM pg_trigger WHERE tgname='a_guard_ticket_insert' AND NOT tgisinternal")).rows).toHaveLength(0);
    await asUser(general);
    const row = await db.query("INSERT INTO tickets(title,created_by,status,resolved_at) VALUES ('Rollback characterization',$1,'resolved',now()) RETURNING status", [general]);
    expect(row.rows).toEqual([{ status: 'resolved' }]); // Rollback reopens this vulnerability.
  });
  it('asset creation rollback removes the RPC without discarding allocation or retry records', async () => {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
    const before = await db.query('SELECT count(*)::int AS total FROM asset_creation_requests');
    await db.exec(readFileSync(new URL('../../../../supabase/rollbacks/20261101000018_create_asset_atomically.sql', import.meta.url), 'utf8'));
    expect((await db.query("SELECT to_regprocedure('public.create_asset_with_history(uuid,jsonb)') AS fn")).rows).toEqual([{ fn: null }]);
    expect(await db.query('SELECT count(*)::int AS total FROM asset_creation_requests')).toEqual(before);
    await db.exec(script('20261101000018_create_asset_atomically.sql'));
    await asUser(admin);
    const replay = await db.query("SELECT (public.create_asset_with_history($1,$2::jsonb)).id AS id", ['40000000-0000-4000-8000-000000000001', JSON.stringify({ name: 'LOCAL-ATOMIC', category: 'laptop', status: 'active', pm_required: false })]);
    expect(replay.rows).toHaveLength(1);
  });
  it('SLA rollback restores prior functions without deleting delivery history', async () => {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
    const before = await db.query('SELECT count(*)::int AS total FROM sla_notification_deliveries');
    await db.exec(readFileSync(new URL('../../../../supabase/rollbacks/20261101000017_sla_recipient_dedup.sql', import.meta.url), 'utf8'));
    const old = await db.query<{ definition: string }>("SELECT pg_get_functiondef('public.notify_sla_at_risk()'::regprocedure) AS definition");
    expect(old.rows[0].definition).not.toContain('sla_notification_deliveries');
    expect(await db.query('SELECT count(*)::int AS total FROM sla_notification_deliveries')).toEqual(before);
    await db.exec(script('20261101000017_sla_recipient_dedup.sql'));
    const restored = await db.query<{ definition: string }>("SELECT pg_get_functiondef('public.notify_sla_at_risk()'::regprocedure) AS definition");
    expect(restored.rows[0].definition).toContain('sla_notification_deliveries');
  });
  it('allocator rollback restores the old function but preserves the protected counter', async () => {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
    await db.exec(readFileSync(new URL('../../../../supabase/rollbacks/20261101000016_ticket_number_allocator.sql', import.meta.url), 'utf8'));
    const definition = await db.query<{ definition: string }>("SELECT pg_get_functiondef('public.generate_ticket_number()'::regprocedure) AS definition");
    expect(definition.rows[0].definition).not.toContain('ticket_number_counters');
    expect((await db.query('SELECT last_issued FROM public.ticket_number_counters')).rows).toHaveLength(1);
    await db.exec(script('20261101000016_ticket_number_allocator.sql'));
    const reapplied = await db.query<{ definition: string }>("SELECT pg_get_functiondef('public.generate_ticket_number()'::regprocedure) AS definition");
    expect(reapplied.rows[0].definition).toContain('ticket_number_counters');
  });

});
