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
  it('previews the strict three-year UTC audit cutoff for active admins without deleting anything', async () => {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
    await db.exec("INSERT INTO entity_change_audit(occurred_at,entity_type,entity_id,operation,new_values) VALUES ('2000-01-01 00:00:00+00','ticket','00000000-0000-4000-8000-000000000077','INSERT','{}'),('2099-01-01 00:00:00+00','ticket','00000000-0000-4000-8000-000000000078','INSERT','{}')");
    await asUser(admin);
    const first = await db.query<{ older_count: number }>("SELECT older_count FROM public.audit_retention_preview()");
    expect(Number(first.rows[0].older_count)).toBe(1);
    expect((await db.query("SELECT three_year_cutoff = (((as_of AT TIME ZONE 'UTC') - interval '3 years') AT TIME ZONE 'UTC') AS correct FROM public.audit_retention_preview()")).rows).toEqual([{ correct: true }]);
    await asUser(support);
    await expect(db.query('SELECT * FROM public.audit_retention_preview()')).rejects.toThrow(/Only active administrators/);
    await asUser(general);
    await expect(db.query('SELECT * FROM public.audit_retention_preview()')).rejects.toThrow(/Only active administrators/);
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); UPDATE profiles SET is_active=false WHERE id='" + admin + "';");
    await asUser(admin);
    await expect(db.query('SELECT * FROM public.audit_retention_preview()')).rejects.toThrow(/Only active administrators/);
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); UPDATE profiles SET is_active=true WHERE id='" + admin + "';");
    const rollback = readFileSync(new URL('../../../../supabase/rollbacks/20261101000021_audit_retention_preview.sql', import.meta.url), 'utf8');
    await db.exec(rollback);
    expect((await db.query("SELECT count(*)::integer AS total FROM entity_change_audit WHERE entity_id IN ('00000000-0000-4000-8000-000000000077','00000000-0000-4000-8000-000000000078')")).rows).toEqual([{ total: 2 }]);
    await db.exec(script('20261101000021_audit_retention_preview.sql'));
    await asUser(admin);
    expect(Number((await db.query<{older_count: number}>('SELECT older_count FROM public.audit_retention_preview()')).rows[0].older_count)).toBe(1);
  });
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
    await db.exec('RESET ROLE; SET ROLE service_role');
    await expect(db.query('SELECT * FROM public.ticket_number_counters')).rejects.toThrow(/permission denied/);
    await expect(db.query('UPDATE public.ticket_number_counters SET last_issued=1')).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
  });
  it('records ticket and asset changes transactionally with a server-derived actor', async () => {
    await asUser(admin);
    const ticket = await db.query<{ id: string }>("INSERT INTO tickets(title,created_by) VALUES ('AUDIT-LOCAL',$1) RETURNING id", [admin]);
    const id = ticket.rows[0].id;
    await asUser(support);
    await db.query("UPDATE tickets SET title='AUDIT-UPDATED' WHERE id=$1", [id]);
    expect((await db.query('SELECT * FROM entity_change_audit WHERE entity_id=$1', [id])).rows).toHaveLength(0);
    await expect(db.query("INSERT INTO entity_change_audit(entity_type,entity_id,operation,new_values) VALUES ('ticket',$1,'INSERT','{}')", [id])).rejects.toThrow(/permission denied/);
    await asUser(admin);
    const events = await db.query<{ operation: string; actor_id: string; old_values: Record<string, unknown>; new_values: Record<string, unknown> }>(
      'SELECT operation,actor_id,old_values,new_values FROM entity_change_audit WHERE entity_id=$1 ORDER BY id', [id]);
    expect(events.rows.map(event => [event.operation, event.actor_id])).toEqual([['INSERT', admin], ['UPDATE', support]]);
    expect(events.rows[1].old_values.title).toBe('AUDIT-LOCAL');
    expect(events.rows[1].new_values.title).toBe('AUDIT-UPDATED');
    await expect(db.query('DELETE FROM entity_change_audit WHERE entity_id=$1', [id])).rejects.toThrow(/permission denied/);
    const asset = await db.query<{ id: string }>("INSERT INTO assets(asset_tag,name,category,pm_required) VALUES ('LOCAL-AUDIT-ASSET','Audit asset','laptop',false) RETURNING id");
    await db.query('DELETE FROM assets WHERE id=$1', [asset.rows[0].id]);
    const assetEvents = await db.query<{ operation: string; actor_id: string }>('SELECT operation,actor_id FROM entity_change_audit WHERE entity_id=$1 ORDER BY id', [asset.rows[0].id]);
    expect(assetEvents.rows).toEqual([{ operation: 'INSERT', actor_id: admin }, { operation: 'DELETE', actor_id: admin }]);
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); ALTER TABLE entity_change_audit ADD CONSTRAINT local_reject_audit CHECK (entity_type <> 'ticket') NOT VALID;");
    await asUser(admin);
    await expect(db.query("UPDATE tickets SET title='MUST-ROLL-BACK' WHERE id=$1", [id])).rejects.toThrow(/local_reject_audit/);
    expect((await db.query('SELECT title FROM tickets WHERE id=$1', [id])).rows).toEqual([{ title: 'AUDIT-UPDATED' }]);
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); ALTER TABLE entity_change_audit DROP CONSTRAINT local_reject_audit;");
    const before = await db.query('SELECT count(*)::int AS n FROM entity_change_audit');
    await db.exec(readFileSync(new URL('../../../../supabase/rollbacks/20261101000019_transactional_entity_audit.sql', import.meta.url), 'utf8'));
    expect(await db.query('SELECT count(*)::int AS n FROM entity_change_audit')).toEqual(before);
    await db.exec(script('20261101000019_transactional_entity_audit.sql'));
    await asUser(admin);
    await db.query("UPDATE tickets SET title='AUDIT-REAPPLIED' WHERE id=$1", [id]);
    expect((await db.query('SELECT operation FROM entity_change_audit WHERE entity_id=$1', [id])).rows).toHaveLength(3);
  });
  it('retains independently attributed audit evidence when comments or asset history are deleted', async () => {
    await asUser(general);
    const ticket = await db.query<{ id: string }>("INSERT INTO tickets(title,created_by) VALUES ('AUDIT-COMMENT',$1) RETURNING id", [general]);
    const comment = await db.query<{ id: string }>("INSERT INTO ticket_comments(ticket_id,created_by,comment_text) VALUES ($1,$2,'Actual message') RETURNING id", [ticket.rows[0].id, general]);
    await asUser(admin);
    await db.query('DELETE FROM ticket_comments WHERE id=$1', [comment.rows[0].id]);
    const commentEvents = await db.query<{ operation: string; actor_id: string; old_values: { comment_text?: string } | null }>(
      "SELECT operation,actor_id,old_values FROM entity_change_audit WHERE entity_type='ticket_comment' AND entity_id=$1 ORDER BY id", [comment.rows[0].id]);
    expect(commentEvents.rows.map(event => [event.operation, event.actor_id])).toEqual([['INSERT', general], ['DELETE', admin]]);
    expect(commentEvents.rows[1].old_values?.comment_text).toBe('Actual message');
    const asset = await db.query<{ id: string }>("INSERT INTO assets(asset_tag,name,category,pm_required) VALUES ('LOCAL-AUDIT-HISTORY','Audit history','laptop',false) RETURNING id");
    await asUser(support);
    const history = await db.query<{ id: string }>("INSERT INTO asset_history(asset_id,action,changed_by,new_value) VALUES ($1,'field_updated',$2,'Claim') RETURNING id", [asset.rows[0].id, support]);
    await asUser(admin);
    await db.query('DELETE FROM asset_history WHERE id=$1', [history.rows[0].id]);
    const historyEvents = await db.query<{ operation: string; actor_id: string }>("SELECT operation,actor_id FROM entity_change_audit WHERE entity_type='asset_history' AND entity_id=$1 ORDER BY id", [history.rows[0].id]);
    expect(historyEvents.rows).toEqual([{ operation: 'INSERT', actor_id: support }, { operation: 'DELETE', actor_id: admin }]);
    await asUser(support);
    const maintenance = await db.query<{ id: string }>("SELECT public.record_asset_maintenance($1,'corrective',CURRENT_DATE,$2,'Work',NULL,'40000000-0000-4000-8000-000000000010') AS id", [asset.rows[0].id, support]);
    await asUser(admin);
    expect((await db.query("SELECT operation,actor_id FROM entity_change_audit WHERE entity_type='asset_maintenance' AND entity_id=$1", [maintenance.rows[0].id])).rows).toEqual([{ operation: 'INSERT', actor_id: support }]);
  });
  it('updates a ticket and server-authored activity in one invoker transaction', async () => {
    await asUser(admin);
    const inserted = await db.query<{ id: string; updated_at: string }>("INSERT INTO tickets(title,created_by,assigned_to) VALUES ('ATOMIC-TICKET',$1,$2) RETURNING id,updated_at", [general, support]);
    const { id, updated_at: version } = inserted.rows[0];
    const sql = 'SELECT public.update_ticket_with_activity($1,$2,$3::jsonb,$4) AS id';
    await asUser(support);
    await expect(db.query(sql, [id, version, JSON.stringify({ status: 'closed', assigned_to: null }), null])).rejects.toThrow(/Remarks are required/);
    expect((await db.query(sql, [id, version, JSON.stringify({ status: 'closed', assigned_to: null }), 'Synthetic reason'])).rows).toEqual([{ id }]);
    const current = await db.query<{ status: string; assigned_to: string; updated_at: string }>('SELECT status,assigned_to,updated_at FROM tickets WHERE id=$1', [id]);
    expect(current.rows[0]).toMatchObject({ status: 'closed', assigned_to: support });
    const comments = await db.query<{ created_by: string; comment_text: string }>('SELECT created_by,comment_text FROM ticket_comments WHERE ticket_id=$1 ORDER BY created_at', [id]);
    expect(comments.rows).toHaveLength(1);
    expect(comments.rows[0].created_by).toBe(support);
    expect(comments.rows[0].comment_text).toContain('Synthetic reason');
    expect(comments.rows[0].comment_text).toContain('Assignee retained');
    await expect(db.query(sql, [id, version, JSON.stringify({ priority: 'high' }), null])).rejects.toThrow(/refresh/);
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); ALTER TABLE ticket_comments ADD CONSTRAINT local_reject_atomic_comment CHECK (comment_text NOT LIKE '%Priority changed%') NOT VALID;");
    await asUser(admin);
    const before = await db.query('SELECT priority,updated_at FROM tickets WHERE id=$1', [id]);
    const auditBefore = await db.query('SELECT count(*)::int AS n FROM entity_change_audit WHERE entity_id=$1', [id]);
    await expect(db.query(sql, [id, current.rows[0].updated_at, JSON.stringify({ priority: 'high' }), null])).rejects.toThrow(/local_reject_atomic_comment/);
    expect(await db.query('SELECT priority,updated_at FROM tickets WHERE id=$1', [id])).toEqual(before);
    expect(await db.query('SELECT count(*)::int AS n FROM entity_change_audit WHERE entity_id=$1', [id])).toEqual(auditBefore);
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); ALTER TABLE ticket_comments DROP CONSTRAINT local_reject_atomic_comment;");
    await asUser(second);
    await expect(db.query(sql, [id, current.rows[0].updated_at, JSON.stringify({ status: 'in_progress' }), null])).rejects.toThrow(/not found or not writable/);
    await asUser(general);
    await expect(db.query(sql, [id, current.rows[0].updated_at, JSON.stringify({ priority: 'low' }), null])).rejects.toThrow(/Forbidden/);
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
    await db.exec(readFileSync(new URL('../../../../supabase/rollbacks/20261101000020_ticket_change_with_activity.sql', import.meta.url), 'utf8'));
    expect((await db.query("SELECT to_regprocedure('public.update_ticket_with_activity(uuid,timestamp with time zone,jsonb,text)') AS fn")).rows).toEqual([{ fn: null }]);
    await db.exec(script('20261101000020_ticket_change_with_activity.sql'));
  });
  it('revokes service-role default EXECUTE from the ticket RPC without revoking user access', async () => {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
    await db.exec('GRANT EXECUTE ON FUNCTION public.update_ticket_with_activity(uuid,timestamptz,jsonb,text) TO service_role');
    await db.exec(script('20261101000020_ticket_change_with_activity.sql'));
    const privileges = await db.query("SELECT has_function_privilege('service_role','public.update_ticket_with_activity(uuid,timestamptz,jsonb,text)','EXECUTE') AS service_execute, has_function_privilege('anon','public.update_ticket_with_activity(uuid,timestamptz,jsonb,text)','EXECUTE') AS anon_execute, has_function_privilege('authenticated','public.update_ticket_with_activity(uuid,timestamptz,jsonb,text)','EXECUTE') AS auth_execute");
    expect(privileges.rows).toEqual([{service_execute:false,anon_execute:false,auth_execute:true}]);
    await db.exec('SET ROLE service_role');
    await expect(db.query("SELECT public.update_ticket_with_activity(NULL,NULL,NULL,NULL)")).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
  });
  it('supports owner closure and server-timed hold transitions without widening access', async () => {
    await asUser(admin);
    const ownerTicket = await db.query<{ id: string; updated_at: string }>("INSERT INTO tickets(title,created_by,assigned_to,status,resolved_at) VALUES ('ATOMIC-OWNER',$1,$2,'resolved',now()-interval '1 hour') RETURNING id,updated_at", [general, support]);
    const sql = 'SELECT public.update_ticket_with_activity($1,$2,$3::jsonb,$4) AS id';
    await asUser(general);
    expect((await db.query(sql, [ownerTicket.rows[0].id, ownerTicket.rows[0].updated_at, JSON.stringify({ status: 'closed' }), 'Accepted'])).rows).toEqual([{ id: ownerTicket.rows[0].id }]);
    expect((await db.query('SELECT status,assigned_to FROM tickets WHERE id=$1', [ownerTicket.rows[0].id])).rows).toEqual([{ status: 'closed', assigned_to: support }]);
    await asUser(admin);
    const held = await db.query<{ id: string }>("INSERT INTO tickets(title,created_by,status,on_hold_at,total_hold_seconds) VALUES ('ATOMIC-HOLD',$1,'on_hold',now()-interval '2 hours',15) RETURNING id", [general]);
    const version = await db.query<{ updated_at: string }>('SELECT updated_at FROM tickets WHERE id=$1', [held.rows[0].id]);
    await asUser(support);
    await db.query(sql, [held.rows[0].id, version.rows[0].updated_at, JSON.stringify({ status: 'in_progress' }), null]);
    const result = await db.query<{ status: string; on_hold_at: string | null; total_hold_seconds: number }>('SELECT status,on_hold_at,total_hold_seconds FROM tickets WHERE id=$1', [held.rows[0].id]);
    expect(result.rows[0]).toMatchObject({ status: 'in_progress', on_hold_at: null });
    expect(result.rows[0].total_hold_seconds).toBeGreaterThanOrEqual(7215);
    await expect(db.query(sql, [held.rows[0].id, version.rows[0].updated_at, JSON.stringify({ title: 'Forbidden' }), null])).rejects.toThrow(/Invalid ticket change/);
  });
  it('characterizes why prototype RLS alone cannot protect real SECURITY DEFINER business functions', async () => {
    // The whole experiment is rolled back. It deliberately demonstrates a
    // bypass, not a production exploit or a complete authorization audit.
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); BEGIN;");
    try {
      await db.exec("CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),not_after timestamptz)");
      await db.exec(readFileSync(new URL('../../../../supabase/proposals/password-gate/operations.sql', import.meta.url), 'utf8'));
      await db.exec(readFileSync(new URL('../../../../supabase/proposals/password-gate/authorization.sql', import.meta.url), 'utf8'));
      const sid = '10000000-0000-4000-8000-000000000009';
      await db.query('INSERT INTO auth.sessions(id,user_id) VALUES ($1,$2)', [sid,support]);
      await db.exec('SET LOCAL ROLE service_role');
      await db.query('SELECT public.prototype_begin_password_reset($1,$2)', [support,'20000000-0000-4000-8000-000000000009']);
      await db.exec('RESET ROLE');
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [support,JSON.stringify({ session_id: sid })]);
      await db.exec('SET LOCAL ROLE authenticated');
      expect((await db.query('SELECT public.prototype_password_gate_status() AS phase')).rows).toEqual([{ phase: 'resetting' }]);
      expect((await db.query('SELECT id FROM assets')).rows).toEqual([]);
      expect((await db.query('SELECT public.get_my_role() AS role')).rows).toEqual([{ role: 'support_staff' }]);
      // This prepared (not live-deployed) RPC bypasses table RLS because its
      // owner executes it and its role check has no trusted gate check.
      const asset = await db.query<{id: string}>("SELECT (public.create_asset_with_history($1,$2::jsonb)).id AS id", [
        '40000000-0000-4000-8000-000000000019',JSON.stringify({ name: 'Synthetic definer bypass',category: 'laptop',pm_required: false }),
      ]);
      expect(asset.rows).toHaveLength(1);
      // The maintenance RPC exists in the live workflow, but this test only
      // exercises a synthetic schema, without hosted gateway or JWT behavior.
      const maintenance = await db.query("SELECT public.record_asset_maintenance($1,'corrective',CURRENT_DATE,$2,'Synthetic definer bypass',NULL,$3) AS id", [
        asset.rows[0].id,support,'40000000-0000-4000-8000-000000000020',
      ]);
      expect(maintenance.rows[0]).toHaveProperty('id');
      expect((await db.query('SELECT id FROM asset_maintenance_log')).rows).toEqual([]);
      // Experiment with two foundational role helpers. This closes these two
      // examples only; other definer paths and Edge functions may still bypass.
      await db.exec('RESET ROLE');
      await db.exec(readFileSync(new URL('../../../../supabase/proposals/password-gate/role-helpers.sql', import.meta.url), 'utf8'));
      await db.exec('SET LOCAL ROLE authenticated');
      expect((await db.query('SELECT public.get_my_role() AS role, public.is_active_user() AS active')).rows).toEqual([{ role: null, active: false }]);
      await db.exec('SAVEPOINT asset_attempt');
      await expect(db.query("SELECT public.create_asset_with_history($1,$2::jsonb)", ['40000000-0000-4000-8000-000000000021',JSON.stringify({name:'Denied',category:'laptop',pm_required:false})])).rejects.toThrow(/Only active administrators/);
      await db.exec('ROLLBACK TO SAVEPOINT asset_attempt; SAVEPOINT maintenance_attempt');
      await expect(db.query("SELECT public.record_asset_maintenance($1,'corrective',CURRENT_DATE,$2,'Denied',NULL,$3)", [asset.rows[0].id,support,'40000000-0000-4000-8000-000000000022'])).rejects.toThrow(/Only active administrators/);
      await db.exec('ROLLBACK TO SAVEPOINT maintenance_attempt; RESET ROLE; SET LOCAL ROLE service_role');
      await db.query('SELECT public.prototype_finish_password_reset($1,$2)', [support,'20000000-0000-4000-8000-000000000009']);
      await db.query('SELECT public.prototype_begin_password_change($1,$2)', [support,'20000000-0000-4000-8000-000000000010']);
      // A service assertion is NOT evidence of an actual Auth password change.
      await db.query('SELECT public.prototype_finish_password_change($1,$2)', [support,'20000000-0000-4000-8000-000000000010']);
      await db.exec('RESET ROLE; SET LOCAL ROLE authenticated');
      expect((await db.query('SELECT public.get_my_role() AS role')).rows).toEqual([{ role: null }]);
      await db.exec('RESET ROLE');
      const newSid = '10000000-0000-4000-8000-000000000010';
      await db.query('INSERT INTO auth.sessions(id,user_id,created_at) VALUES ($1,$2,clock_timestamp())',[newSid,support]);
      await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({session_id:newSid})]);
      await db.exec('SET LOCAL ROLE authenticated');
      expect((await db.query('SELECT public.get_my_role() AS role, public.is_active_user() AS active')).rows).toEqual([{role:'support_staff',active:true}]);
    } finally {
      await db.exec('RESET ROLE; ROLLBACK');
    }
  });
  it('synthetically applies session admission to table policies and the sampled definer RPCs', async () => {
    // This experiment is entirely rolled back. The service assertion does not
    // verify any password; this does not audit all RPCs, sessions or Edge paths.
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); BEGIN;");
    const sid = '10000000-0000-4000-8000-000000000011';
    const adminSid = '10000000-0000-4000-8000-000000000012';
    const reset = '20000000-0000-4000-8000-000000000011';
    const change = '20000000-0000-4000-8000-000000000012';
    const adminReset = '20000000-0000-4000-8000-000000000014';
    const adminChange = '20000000-0000-4000-8000-000000000015';
    const load = (name: string) => readFileSync(new URL(`../../../../supabase/proposals/password-gate/${name}`, import.meta.url), 'utf8');
    try {
      await db.exec('CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),not_after timestamptz)');
      for (const name of ['operations.sql', 'authorization.sql', 'session-authorization.sql', 'admission-integration.sql', 'role-helpers.sql', 'onboarding.sql']) await db.exec(load(name));
      // A newly inserted Auth user must be born blocked in the same transaction.
      const newUser = '00000000-0000-4000-8000-000000000090';
      await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,'new@example.invalid','{\"full_name\":\"Synthetic new user\"}')", [newUser]);
      expect((await db.query('SELECT phase FROM password_operation_prototype WHERE user_id=$1',[newUser])).rows).toEqual([{phase:'required'}]);
      expect((await db.query('SELECT must_change_password FROM profiles WHERE id=$1',[newUser])).rows).toEqual([{must_change_password:true}]);
      await db.exec('SET LOCAL ROLE service_role');
      await db.query('SELECT public.prototype_begin_password_reset($1,$2)', [support,reset]);
      await db.query('SELECT public.prototype_finish_password_reset($1,$2)', [support,reset]);
      await db.query('SELECT public.prototype_begin_password_change($1,$2)', [support,change]);
      await db.query('SELECT public.prototype_finish_password_change($1,$2)', [support,change]);
      await db.query('SELECT public.prototype_begin_password_reset($1,$2)', [admin,adminReset]);
      await db.query('SELECT public.prototype_finish_password_reset($1,$2)', [admin,adminReset]);
      await db.query('SELECT public.prototype_begin_password_change($1,$2)', [admin,adminChange]);
      await db.query('SELECT public.prototype_finish_password_change($1,$2)', [admin,adminChange]);
      await db.exec('RESET ROLE');
      await db.query('INSERT INTO auth.sessions(id,user_id,created_at) VALUES ($1,$2,clock_timestamp()),($3,$4,clock_timestamp())', [sid,support,adminSid,admin]);
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [support,JSON.stringify({session_id:sid})]);
      await db.exec('SET LOCAL ROLE authenticated');
      expect((await db.query('SELECT id FROM assets')).rows).toEqual([]);
      expect((await db.query('SELECT public.get_my_role() AS role')).rows).toEqual([{role:null}]);
      await db.exec('SAVEPOINT denied_asset');
      await expect(db.query('SELECT public.create_asset_with_history($1,$2::jsonb)', ['40000000-0000-4000-8000-000000000031',JSON.stringify({name:'Denied',category:'laptop',pm_required:false})])).rejects.toThrow(/Only active administrators/);
      await db.exec('ROLLBACK TO SAVEPOINT denied_asset; SAVEPOINT denied_schedule');
      await expect(db.query('SELECT public.update_asset_pm_schedule($1,NULL,NULL,false,NULL,NULL,false)', ['40000000-0000-4000-8000-000000000030'])).rejects.toThrow(/Not authorized/);
      await db.exec('ROLLBACK TO SAVEPOINT denied_schedule; RESET ROLE; SET LOCAL ROLE service_role');
      await db.query('SELECT public.prototype_admit_verified_session($1,$2,$3)', [support,sid,change]);
      await db.exec('RESET ROLE; SET LOCAL ROLE authenticated');
      expect((await db.query('SELECT public.get_my_role() AS role')).rows).toEqual([{role:'support_staff'}]);
      const created = await db.query<{id:string}>('SELECT (public.create_asset_with_history($1,$2::jsonb)).id AS id', ['40000000-0000-4000-8000-000000000032',JSON.stringify({name:'Admitted synthetic',category:'laptop',pm_required:false})]);
      expect(created.rows).toHaveLength(1);
      await db.query('SELECT public.update_asset_pm_schedule($1,NULL,NULL,false,NULL,NULL,false)', [created.rows[0].id]);
      const maintenance = await db.query("SELECT public.record_asset_maintenance($1,'corrective',CURRENT_DATE,$2,'Synthetic',NULL,$3) AS id", [created.rows[0].id,support,'40000000-0000-4000-8000-000000000033']);
      expect(maintenance.rows[0]).toHaveProperty('id');
      await db.exec('RESET ROLE');
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [admin,JSON.stringify({session_id:adminSid})]);
      await db.exec('SET LOCAL ROLE authenticated; SAVEPOINT denied_correction');
      await expect(db.query("SELECT public.correct_asset_maintenance($1,$2,'Denied','Denied')", [(maintenance.rows[0] as {id:string}).id,support])).rejects.toThrow(/Only administrators/);
      await db.exec('ROLLBACK TO SAVEPOINT denied_correction; SAVEPOINT denied_return');
      await expect(db.query('SELECT public.return_asset_to_service($1)', [created.rows[0].id])).rejects.toThrow(/Only active administrators/);
      await db.exec('ROLLBACK TO SAVEPOINT denied_return; RESET ROLE; SET LOCAL ROLE service_role');
      await db.query('SELECT public.prototype_admit_verified_session($1,$2,$3)', [admin,adminSid,adminChange]);
      await db.exec('RESET ROLE; SET LOCAL ROLE authenticated');
      await db.query("SELECT public.correct_asset_maintenance($1,$2,'Corrected','Synthetic correction')", [(maintenance.rows[0] as {id:string}).id,support]);
      await db.query("UPDATE assets SET status='maintenance' WHERE id=$1",[created.rows[0].id]);
      await db.query('SELECT public.return_asset_to_service($1)', [created.rows[0].id]);
      await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role");
      await db.query('SELECT public.prototype_begin_password_reset($1,$2)', [support,'20000000-0000-4000-8000-000000000013']);
      await db.exec('RESET ROLE');
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)",[support,JSON.stringify({session_id:sid})]);
      await db.exec('SET LOCAL ROLE authenticated');
      expect((await db.query('SELECT public.get_my_role() AS role')).rows).toEqual([{role:null}]);
      expect((await db.query('SELECT id FROM assets')).rows).toEqual([]);
      await db.exec('SAVEPOINT denied_maintenance');
      await expect(db.query("SELECT public.record_asset_maintenance($1,'corrective',CURRENT_DATE,$2,'Denied',NULL,$3)", [created.rows[0].id,support,'40000000-0000-4000-8000-000000000034'])).rejects.toThrow(/Only active administrators/);
      await db.exec('ROLLBACK TO SAVEPOINT denied_maintenance');
    } finally {
      await db.exec('RESET ROLE; ROLLBACK');
    }
  });
  it('removes Supabase-style service default grants from asset counters, request ledger and RPC', async () => {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);");
    // Simulate live public-schema defaults even on reapplication over retained tables.
    await db.exec('GRANT ALL ON public.asset_tag_counters,public.asset_creation_requests TO service_role; GRANT EXECUTE ON FUNCTION public.create_asset_with_history(uuid,jsonb) TO service_role');
    await db.exec(script('20261101000018_create_asset_atomically.sql'));
    const privileges = await db.query("SELECT has_table_privilege('service_role','public.asset_tag_counters','SELECT') AS counter_select, has_table_privilege('service_role','public.asset_creation_requests','INSERT') AS ledger_insert, has_function_privilege('service_role','public.create_asset_with_history(uuid,jsonb)','EXECUTE') AS rpc_execute, has_function_privilege('authenticated','public.create_asset_with_history(uuid,jsonb)','EXECUTE') AS auth_execute");
    expect(privileges.rows).toEqual([{counter_select:false,ledger_insert:false,rpc_execute:false,auth_execute:true}]);
    await db.exec('SET ROLE service_role');
    await expect(db.query('SELECT * FROM public.asset_creation_requests')).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
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
