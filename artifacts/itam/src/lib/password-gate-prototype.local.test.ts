import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// State-machine experiment only. This does not load GoTrue, validate JWTs or
// enforce access; a trusted service can deliberately finish without proof.
const user = '00000000-0000-4000-8000-000000000001';
const missing = '00000000-0000-4000-8000-000000000002';
const reset = '10000000-0000-4000-8000-000000000001';
const change = '10000000-0000-4000-8000-000000000002';
const newer = '10000000-0000-4000-8000-000000000003';
const canceled = '10000000-0000-4000-8000-000000000004';
let db: PGlite;
const state = async () => (await db.query('SELECT phase,operation_id FROM password_operation_prototype WHERE user_id=$1', [user])).rows[0];
const call = (fn: string, operation: string, id = user) => db.query(`SELECT public.${fn}($1,$2)`, [id, operation]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,must_change_password boolean NOT NULL DEFAULT false,password_changed_at timestamptz);
    INSERT INTO public.profiles(id) VALUES ('${user}');`);
  await db.exec(readFileSync(new URL('../../../../supabase/proposals/password-gate/operations.sql', import.meta.url), 'utf8'));
});
afterAll(async () => db?.close());

describe('password operation prototype (not enforcement)', () => {
  it('denies direct access and service-only operations to authenticated users', async () => {
    await db.exec('SET ROLE authenticated');
    await expect(db.query('SELECT * FROM password_operation_prototype')).rejects.toThrow(/permission denied/);
    await expect(call('prototype_begin_password_reset', reset)).rejects.toThrow(/permission denied/);
    await expect(call('prototype_finish_password_change', change)).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
  });
  it('serializes reset and change; mismatched or stale completions cannot clear a later operation', async () => {
    await db.exec('SET ROLE service_role');
    await call('prototype_begin_password_reset', reset);
    await expect(call('prototype_begin_password_reset', reset)).rejects.toThrow(/already in progress/);
    await expect(call('prototype_begin_password_change', change)).rejects.toThrow(/not available/);
    await expect(call('prototype_finish_password_change', change)).rejects.toThrow(/mismatch/);
    await call('prototype_finish_password_reset', reset);
    await call('prototype_finish_password_reset', reset); // safe acknowledgement retry only
    await expect(call('prototype_begin_password_change', reset)).rejects.toThrow(/not available/);
    await call('prototype_begin_password_change', change);
    await expect(call('prototype_begin_password_reset', newer)).rejects.toThrow(/already in progress/);
    await call('prototype_finish_password_change', change);
    await call('prototype_finish_password_change', change);
    await call('prototype_begin_password_reset', newer);
    await expect(call('prototype_finish_password_change', change)).rejects.toThrow(/mismatch/);
    await db.exec('RESET ROLE');
    expect(await state()).toEqual({ phase: 'resetting', operation_id: newer });
    expect((await db.query('SELECT must_change_password FROM profiles WHERE id=$1', [user])).rows).toEqual([{ must_change_password: true }]);
  });
  it('keeps an ambiguous operation locked and only allows trusted pre-attempt cancellation', async () => {
    await db.exec('SET ROLE service_role');
    await call('prototype_finish_password_reset', newer);
    await call('prototype_begin_password_change', canceled);
    await expect(call('prototype_begin_password_change', change)).rejects.toThrow(/not available/);
    await call('prototype_cancel_unattempted_change', canceled);
    await expect(call('prototype_finish_password_change', canceled)).rejects.toThrow(/mismatch/);
    await expect(call('prototype_begin_password_reset', reset, missing)).rejects.toThrow(/foreign key/);
    await db.exec('RESET ROLE');
    expect(await state()).toEqual({ phase: 'required', operation_id: canceled });
    expect((await db.query('SELECT must_change_password FROM profiles WHERE id=$1', [user])).rows).toEqual([{ must_change_password: true }]);
  });
});
