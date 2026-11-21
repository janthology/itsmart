// Destructive test setup: only run against a NEW, disposable local PostgreSQL
// cluster. Never point this at Supabase or a shared development database.
// Tests the trusted password gate Phase 1 functions (migration 20261101000024)
// under real concurrency: racing starts, racing stale completions and an
// admission that must wait behind a reset. Synthetic Auth tables only; this is
// not GoTrue.
import assert from 'node:assert/strict';
import { realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const socket = process.env.ITSMART_TEST_PG_SOCKET;
const port = Number(process.env.ITSMART_TEST_PG_PORT || 55432);
const isTemporary = value => value.startsWith(realpathSync(tmpdir()) + sep);
if (process.env.ITSMART_DISPOSABLE_PG !== '1' || !socket || !isTemporary(realpathSync(socket)) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Use ITSMART_DISPOSABLE_PG=1 and a local temporary Unix socket on a new disposable PostgreSQL cluster.');
}
const options = { host: resolve(socket), port, user: 'postgres', database: 'postgres' };
const control = new pg.Client(options);
const dbName = `itsmart_gate_test_${randomBytes(8).toString('hex')}`;
let databaseCreated = false;
const rolesCreated = [];
let pool;
const uuid = n => `50000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

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
  pool = new pg.Pool({ ...options, database: dbName, max: 40 });

  // Minimal prerequisites: the real migration references these tables and roles.
  await pool.query(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY, user_id uuid NOT NULL, created_at timestamptz, not_after timestamptz);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
  `);
  await pool.query(readFileSync(new URL('../../../supabase/migrations/20261101000024_password_gate_infrastructure.sql', import.meta.url), 'utf8'));
  for (let n = 1; n <= 150; n++) await pool.query('INSERT INTO public.profiles(id) VALUES ($1)', [uuid(n)]);

  const fn = async (sql, params) => {
    const client = await pool.connect();
    try {
      await client.query('SET ROLE service_role');
      return await client.query(sql, params);
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      client.release();
    }
  };
  const phase = async user => (await pool.query('SELECT phase, operation_id FROM public.password_gate_state WHERE user_id=$1', [user])).rows[0] ?? null;
  const settle = results => ({
    ok: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').map(r => r.reason.message),
  });

  // 1. Racing reset starts for the same account: exactly one wins, the rest are refused.
  {
    const user = uuid(1);
    const attempts = await Promise.allSettled(Array.from({ length: 24 }, (_, i) => fn('SELECT public.password_gate_begin_reset($1,$2)', [user, uuid(1000 + i)])));
    const summary = settle(attempts);
    assert.equal(summary.ok, 1, `expected exactly one winning reset, got ${summary.ok}`);
    assert.ok(summary.failed.every(message => /already in progress/.test(message)), `unexpected errors: ${[...new Set(summary.failed)].join(' | ')}`);
    assert.equal((await phase(user)).phase, 'resetting');
    console.log('PASS: 24 racing reset starts for one account produced exactly one in-progress operation.');
  }

  // 2. Racing change starts from 'required': exactly one wins.
  {
    const user = uuid(1);
    await fn('SELECT public.password_gate_finish_reset($1,$2)', [user, (await phase(user)).operation_id]);
    const attempts = await Promise.allSettled(Array.from({ length: 24 }, (_, i) => fn('SELECT public.password_gate_begin_change($1,$2)', [user, uuid(2000 + i)])));
    const summary = settle(attempts);
    assert.equal(summary.ok, 1, `expected exactly one winning change, got ${summary.ok}`);
    assert.ok(summary.failed.every(message => /not available/.test(message)), `unexpected errors: ${[...new Set(summary.failed)].join(' | ')}`);
    assert.equal((await phase(user)).phase, 'changing');
    console.log('PASS: 24 racing change starts from required produced exactly one change.');
  }

  // 3. Stale-completion race, repeated 40 times on separate accounts. A stale
  //    reset completion races a new reset start. Whatever the order, the stale
  //    completion must not clear the new operation, and the new reset must win.
  {
    for (let round = 0; round < 40; round++) {
      const user = uuid(100 + round);
      const staleOp = uuid(3000 + round * 2);
      const newOp = uuid(3001 + round * 2);
      await fn('SELECT public.password_gate_begin_reset($1,$2)', [user, staleOp]);
      await fn('SELECT public.password_gate_finish_reset($1,$2)', [user, staleOp]);
      const [stale, fresh] = await Promise.allSettled([
        fn('SELECT public.password_gate_finish_reset($1,$2)', [user, staleOp]),
        fn('SELECT public.password_gate_begin_reset($1,$2)', [user, newOp]),
      ]);
      assert.equal(fresh.status, 'fulfilled', `round ${round}: new reset refused: ${fresh.reason?.message}`);
      if (stale.status === 'rejected') assert.match(stale.reason.message, /mismatch/, `round ${round}`);
      assert.deepEqual(await phase(user), { phase: 'resetting', operation_id: newOp }, `round ${round}: stale completion changed the new operation`);
    }
    console.log('PASS: 40 races between a stale reset completion and a new reset never cleared the newer operation.');
  }

  // 4. Admission must wait behind a reset that holds the account lock, and must
  //    then be refused under the new generation.
  {
    const user = uuid(50);
    const session = uuid(5000);
    await pool.query("INSERT INTO auth.sessions(id,user_id,created_at) VALUES ($1,$2,clock_timestamp() - interval '1 day')", [uuid(4999), user]);
    await fn('SELECT public.password_gate_begin_reset($1,$2)', [user, uuid(4000)]);
    await fn('SELECT public.password_gate_finish_reset($1,$2)', [user, uuid(4000)]);
    await fn('SELECT public.password_gate_begin_change($1,$2)', [user, uuid(4001)]);
    await fn('SELECT public.password_gate_finish_change($1,$2)', [user, uuid(4001)]);
    const generation = uuid(4001);
    await pool.query("INSERT INTO auth.sessions(id,user_id,created_at) VALUES ($1,$2,clock_timestamp())", [session, user]);

    const reset = await pool.connect();
    const admitter = await pool.connect();
    try {
      await reset.query('BEGIN');
      await reset.query('SELECT public.password_gate_begin_reset($1,$2)', [user, uuid(4002)]);
      await admitter.query('SET ROLE service_role');
      const pid = (await admitter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const admission = admitter.query('SELECT public.password_gate_admit_session($1,$2,$3)', [user, session, generation]);
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const state = await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid]);
        if (state.rows[0]?.wait_event_type === 'Lock') { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.ok(blocked, 'admission did not wait for the reset lock');
      await reset.query('COMMIT');
      await assert.rejects(admission, /generation changed/);
      const rows = await pool.query('SELECT 1 FROM public.password_gate_admitted_sessions WHERE session_id=$1', [session]);
      assert.equal(rows.rows.length, 0, 'a stale admission was stored');
      assert.equal((await phase(user)).phase, 'resetting');
    } finally {
      await reset.query('ROLLBACK').catch(() => {});
      reset.release();
      await admitter.query('RESET ROLE').catch(() => {});
      admitter.release();
    }
    console.log('PASS: an admission waited behind a reset lock, then was refused under the new operation.');
  }

  // 5. Admission racing a completed change for the same generation: exactly one
  //    stored row, and no duplicate admission rows.
  {
    const user = uuid(51);
    const session = uuid(5100);
    await pool.query("INSERT INTO auth.sessions(id,user_id,created_at) VALUES ($1,$2,clock_timestamp() + interval '1 second')", [session, user]);
    await fn('SELECT public.password_gate_begin_reset($1,$2)', [user, uuid(5101)]);
    await fn('SELECT public.password_gate_finish_reset($1,$2)', [user, uuid(5101)]);
    await fn('SELECT public.password_gate_begin_change($1,$2)', [user, uuid(5102)]);
    await fn('SELECT public.password_gate_finish_change($1,$2)', [user, uuid(5102)]);
    const attempts = await Promise.allSettled(Array.from({ length: 16 }, () => fn('SELECT public.password_gate_admit_session($1,$2,$3)', [user, session, uuid(5102)])));
    assert.equal(settle(attempts).ok, 16, 'every identical admission should succeed or re-admit idempotently');
    const rows = await pool.query('SELECT count(*)::int AS n FROM public.password_gate_admitted_sessions WHERE session_id=$1', [session]);
    assert.equal(rows.rows[0].n, 1);
    console.log('PASS: 16 concurrent identical admissions stored exactly one row.');
  }
  console.log('All password-gate Phase 1 concurrency checks passed.');
} finally {
  if (pool) await pool.end();
  if (databaseCreated) await control.query(`DROP DATABASE IF EXISTS ${dbName}`);
  for (const role of rolesCreated.reverse()) await control.query(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
  await control.end().catch(() => {});
}
