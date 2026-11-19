// Destructive test setup: only run against a NEW, disposable local PostgreSQL
// cluster. Never point this at Supabase or a shared development database.
// See docs/security-remediation-stage-1.md for prerequisites and limitations.
import assert from 'node:assert/strict';
import { realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

const socket = process.env.ITSMART_TEST_PG_SOCKET;
const port = Number(process.env.ITSMART_TEST_PG_PORT || 55432);
const isTemporary = value => value.startsWith(realpathSync(tmpdir()) + sep);
if (process.env.ITSMART_DISPOSABLE_PG !== '1' || !socket || !isTemporary(realpathSync(socket)) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Use ITSMART_DISPOSABLE_PG=1 and a local temporary Unix socket on a new disposable PostgreSQL cluster.');
}
const options = { host: resolve(socket), port, user: 'postgres', database: 'postgres' };
const control = new pg.Client(options);
const dbName = `itsmart_allocator_test_${randomBytes(8).toString('hex')}`;
let databaseCreated = false;
const rolesCreated = [];
let pool;
try {
  await control.connect();
  const metadata = await control.query(`
    SELECT inet_server_addr() IS NULL AS unix_socket, current_setting('data_directory') AS data_directory,
      (SELECT count(*)::int FROM pg_database WHERE datallowconn AND NOT datistemplate AND datname <> 'postgres') AS other_databases,
      (SELECT count(*)::int FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) AS existing_app_roles,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')) AS public_objects
  `);
  const info = metadata.rows[0];
  if (!info.unix_socket || !isTemporary(realpathSync(info.data_directory)) || info.other_databases || info.existing_app_roles || info.public_objects) {
    throw new Error('Refusing: server is not a fresh temporary disposable cluster.');
  }
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await control.query(`CREATE ROLE ${role}`);
    rolesCreated.push(role);
  }
  await control.query(`CREATE DATABASE ${dbName}`);
  databaseCreated = true;
  pool = new pg.Pool({ ...options, database: dbName, max: 30 });
  const migration = readFileSync(new URL('../../../supabase/migrations/20261101000016_ticket_number_allocator.sql', import.meta.url), 'utf8');
  await pool.query(`CREATE TABLE public.profiles(id uuid PRIMARY KEY);
    CREATE TABLE public.tickets(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, ticket_number text UNIQUE,
      title text DEFAULT 'Synthetic', created_by uuid, assigned_to uuid, status text DEFAULT 'open',
      priority text DEFAULT 'high', created_at timestamptz DEFAULT now(), total_hold_seconds integer DEFAULT 0);
    CREATE TABLE public.notifications(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL,
      type text NOT NULL, title text NOT NULL, body text, link text);
    CREATE FUNCTION public.sla_hours(priority text) RETURNS numeric LANGUAGE sql IMMUTABLE AS 'SELECT 4::numeric';
    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT INSERT, SELECT ON public.tickets TO authenticated;`);
  await pool.query(migration);
  await pool.query('CREATE TRIGGER set_ticket_number BEFORE INSERT ON public.tickets FOR EACH ROW WHEN (NEW.ticket_number IS NULL) EXECUTE FUNCTION public.generate_ticket_number()');
  const attempts = await Promise.allSettled(Array.from({ length: 24 }, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE authenticated');
      const inserted = await client.query('INSERT INTO public.tickets DEFAULT VALUES RETURNING ticket_number');
      // Hold the counter row lock briefly to force overlapping transactions.
      await client.query('SELECT pg_sleep(0.02)');
      await client.query('COMMIT');
      return inserted.rows[0].ticket_number;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }));
  const rejected = attempts.filter(result => result.status === 'rejected');
  if (rejected.length) throw new AggregateError(rejected.map(result => result.reason), 'Concurrent inserts failed');
  const numbers = attempts.map(result => result.value);
  assert.equal(new Set(numbers).size, 24);
  assert.deepEqual(numbers.map(number => Number(number.slice(-5))).sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => i + 1));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    const rolledBack = await client.query('INSERT INTO public.tickets DEFAULT VALUES RETURNING ticket_number');
    await client.query('ROLLBACK');
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    const next = await client.query('INSERT INTO public.tickets DEFAULT VALUES RETURNING ticket_number');
    assert.equal(next.rows[0].ticket_number, rolledBack.rows[0].ticket_number);
    await client.query('COMMIT');
  } finally { client.release(); }
  console.log('PASS: 24 overlapping authenticated inserts produced distinct consecutive numbers; an aborted allocation rolled back.');
  const slaMigration = readFileSync(new URL('../../../supabase/migrations/20261101000017_sla_recipient_dedup.sql', import.meta.url), 'utf8');
  await pool.query(slaMigration);
  const profile = await pool.query('INSERT INTO public.profiles(id) VALUES (gen_random_uuid()) RETURNING id');
  const userId = profile.rows[0].id;
  const ticket = await pool.query("INSERT INTO public.tickets(title, created_by, assigned_to, created_at) VALUES ('Synthetic alert',$1,$1,now()-interval '3 hours 10 minutes') RETURNING id", [userId]);
  const ticketId = ticket.rows[0].id;
  const calls = await Promise.allSettled(Array.from({ length: 16 }, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT public.notify_sla_at_risk()');
      await client.query('SELECT pg_sleep(0.02)');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }));
  const slaErrors = calls.filter(result => result.status === 'rejected');
  if (slaErrors.length) throw new AggregateError(slaErrors.map(result => result.reason), 'Concurrent SLA jobs failed');
  const deliveries = await pool.query('SELECT count(*)::int AS total FROM public.sla_notification_deliveries WHERE ticket_id=$1', [ticketId]);
  const notifications = await pool.query("SELECT count(*)::int AS total FROM public.notifications WHERE link=$1 AND type='sla_at_risk'", [`/tickets/${ticketId}`]);
  assert.equal(deliveries.rows[0].total, 1);
  assert.equal(notifications.rows[0].total, 1);
  console.log('PASS: 16 overlapping SLA jobs created exactly one delivery and notification for the same requester/assignee.');

  // Minimal synthetic Auth/profile/asset schema for real concurrent RPC calls;
  // this is not the hosted Supabase Auth or PostgREST stack.
  await pool.query(`
    CREATE TYPE public.user_role AS ENUM ('administrator','support_staff','general_user');
    CREATE TYPE public.asset_status AS ENUM ('active','inactive','maintenance','retired');
    CREATE TYPE public.asset_category_type AS ENUM ('laptop','other');
    ALTER TABLE public.profiles ADD COLUMN role public.user_role NOT NULL DEFAULT 'administrator', ADD COLUMN is_active boolean NOT NULL DEFAULT true;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION public.get_my_role() RETURNS public.user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT role FROM public.profiles WHERE id=auth.uid() AND is_active $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE public.assets(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, asset_tag text NOT NULL UNIQUE, name text NOT NULL,
      category public.asset_category_type NOT NULL, status public.asset_status NOT NULL DEFAULT 'active', assigned_to uuid,
      purchase_date date, purchase_value numeric, notes text, serial_number text, location text, model text,
      last_pm_date date, next_pm_date date, pm_required boolean NOT NULL DEFAULT true);
    CREATE TABLE public.asset_history(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, asset_id uuid NOT NULL REFERENCES public.assets(id),
      action text NOT NULL, field_name text, new_value text, changed_by uuid REFERENCES public.profiles(id));
    GRANT SELECT ON public.assets, public.asset_history TO authenticated;
  `);
  const assetMigration = readFileSync(new URL('../../../supabase/migrations/20261101000018_create_asset_atomically.sql', import.meta.url), 'utf8');
  await pool.query(assetMigration);
  const assetPayload = JSON.stringify({ name: 'Synthetic atomic asset', category: 'laptop', pm_required: false });
  const createAsset = async requestId => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [userId]);
      await client.query('SET LOCAL ROLE authenticated');
      const result = await client.query('SELECT (public.create_asset_with_history($1,$2::jsonb)).id AS id', [requestId, assetPayload]);
      await client.query('SELECT pg_sleep(0.02)');
      await client.query('COMMIT');
      return result.rows[0].id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  };
  const uniqueRequests = await Promise.all(Array.from({ length: 16 }, () => createAsset(randomUUID())));
  assert.equal(new Set(uniqueRequests).size, 16);
  const sameRequestId = randomUUID();
  const replayed = await Promise.all(Array.from({ length: 12 }, () => createAsset(sameRequestId)));
  assert.equal(new Set(replayed).size, 1);
  const totals = await pool.query('SELECT (SELECT count(*)::int FROM public.assets) AS assets, (SELECT count(DISTINCT asset_tag)::int FROM public.assets) AS tags, (SELECT count(*)::int FROM public.asset_history) AS history');
  assert.deepEqual(totals.rows[0], { assets: 17, tags: 17, history: 17 });
  console.log('PASS: 16 concurrent asset creates had distinct tags; 12 concurrent retries created one asset and one history entry.');

  const auditMigration = readFileSync(new URL('../../../supabase/migrations/20261101000019_transactional_entity_audit.sql', import.meta.url), 'utf8');
  await pool.query('CREATE TABLE public.ticket_comments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id uuid, comment_text text); CREATE TABLE public.asset_maintenance_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asset_id uuid, description text)');
  await pool.query(auditMigration);
  await pool.query('GRANT UPDATE ON public.tickets TO authenticated');
  const updates = await Promise.allSettled(Array.from({ length: 12 }, async (_, i) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [userId]);
      await client.query('SET LOCAL ROLE authenticated');
      await client.query('UPDATE public.tickets SET title=title || $1 WHERE id=$2', [`-${i}`, ticketId]);
      await client.query('SELECT pg_sleep(0.01)');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }));
  const updateErrors = updates.filter(result => result.status === 'rejected');
  if (updateErrors.length) throw new AggregateError(updateErrors.map(result => result.reason), 'Concurrent audited updates failed');
  const recorded = await pool.query("SELECT count(*)::int AS total FROM entity_change_audit WHERE entity_id=$1 AND operation='UPDATE' AND actor_id=$2", [ticketId, userId]);
  assert.equal(recorded.rows[0].total, 12);
  const original = await pool.query('SELECT title FROM tickets WHERE id=$1', [ticketId]);
  await pool.query("ALTER TABLE entity_change_audit ADD CONSTRAINT test_reject_ticket CHECK (entity_type <> 'ticket') NOT VALID");
  await assert.rejects(pool.query("UPDATE tickets SET title='must roll back' WHERE id=$1", [ticketId]), /test_reject_ticket/);
  assert.deepEqual((await pool.query('SELECT title FROM tickets WHERE id=$1', [ticketId])).rows, original.rows);
  console.log('PASS: 12 concurrent ticket changes produced 12 attributed audit entries; audit failure rolled back the ticket change.');

  await pool.query(`
    ALTER TABLE entity_change_audit DROP CONSTRAINT test_reject_ticket;
    CREATE TYPE public.ticket_status AS ENUM ('open','assigned','in_progress','resolved','closed','on_hold');
    CREATE TYPE public.ticket_priority AS ENUM ('low','medium','high','critical');
    ALTER TABLE public.tickets ALTER COLUMN status DROP DEFAULT, ALTER COLUMN status TYPE public.ticket_status USING status::public.ticket_status,
      ALTER COLUMN priority DROP DEFAULT, ALTER COLUMN priority TYPE public.ticket_priority USING priority::public.ticket_priority,
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN on_hold_at timestamptz,
      ADD COLUMN resolved_at timestamptz, ADD COLUMN closed_at timestamptz;
    ALTER TABLE public.tickets ALTER COLUMN status SET DEFAULT 'open', ALTER COLUMN priority SET DEFAULT 'high';
    ALTER TABLE public.ticket_comments ADD COLUMN created_by uuid, ADD COLUMN is_system boolean NOT NULL DEFAULT false;
    ALTER TABLE public.profiles ADD COLUMN full_name text DEFAULT 'Synthetic administrator';
    CREATE FUNCTION public.is_active_user() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS
      $$ SELECT coalesce((SELECT is_active FROM public.profiles WHERE id=auth.uid()),false) $$;
    CREATE FUNCTION public.synthetic_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at := CURRENT_TIMESTAMP; RETURN NEW; END$$;
    CREATE TRIGGER synthetic_updated_at BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.synthetic_updated_at();
    GRANT SELECT ON public.profiles TO authenticated;
    GRANT INSERT ON public.ticket_comments TO authenticated;
  `);
  const workflowMigration = readFileSync(new URL('../../../supabase/migrations/20261101000020_ticket_change_with_activity.sql', import.meta.url), 'utf8');
  await pool.query(workflowMigration);
  const version = await pool.query('SELECT updated_at::text AS updated_at FROM public.tickets WHERE id=$1', [ticketId]);
  const concurrentChanges = await Promise.allSettled(Array.from({ length: 2 }, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [userId]);
      await client.query('SET LOCAL ROLE authenticated');
      const changed = await client.query("SELECT public.update_ticket_with_activity($1,$2,'{\"status\":\"in_progress\"}'::jsonb,NULL) AS id", [ticketId, version.rows[0].updated_at]);
      await client.query('SELECT pg_sleep(0.05)');
      await client.query('COMMIT');
      return changed.rows[0].id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }));
  assert.equal(concurrentChanges.filter(result => result.status === 'fulfilled').length, 1);
  const rejectedChange = concurrentChanges.find(result => result.status === 'rejected');
  assert.match(String(rejectedChange?.reason), /refresh and try again/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ticket_comments WHERE ticket_id=$1', [ticketId])).rows[0].n, 1);
  console.log('PASS: concurrent ticket workflow requests with the same version produced one change/comment and one stale-version rejection.');
} finally {
  if (pool) await pool.end();
  if (databaseCreated) await control.query(`DROP DATABASE ${dbName}`);
  for (const role of rolesCreated.reverse()) await control.query(`DROP ROLE ${role}`);
  await control.end();
}
