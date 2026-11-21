# Trusted password gate, Phase 1: review package (non-enforcing)

Status (2026-11-21): **built and tested locally. NOT applied to production.** Applying migration `20261101000024` needs your approval of the SQL and rollback below. Nothing in the app calls these functions yet, and no existing policy, grant, trigger or function changes.

Phase 1 is the first of four approved-one-at-a-time steps in `docs/trusted-password-gate-review.md`. Phase 0 scope (all business data) is recorded there.

## What Phase 1 adds

Migration: `supabase/migrations/20261101000024_password_gate_infrastructure.sql`
Rollback: `supabase/rollbacks/20261101000024_password_gate_infrastructure.sql`

Tables (both RLS on, no policies, no grants to `PUBLIC`, `anon`, `authenticated` or `service_role`):

- `public.password_gate_state`: one row per gated account. `phase` is `required`, `resetting`, `changing` or `cleared`. `operation_id` is the current operation, and for `cleared` it is the **generation**.
- `public.password_gate_admitted_sessions`: a verified Auth session admitted under one generation. Deleting the Auth session deletes its row.

Functions (all `SECURITY DEFINER`, fixed `search_path`, executable only by `service_role`):

| Function | Moves | Rule |
| --- | --- | --- |
| `password_gate_begin_reset(user, op)` | any → `resetting` | Refused while `resetting` or `changing`. Refused for a reused operation ID. Refused for an unknown profile. |
| `password_gate_finish_reset(user, op)` | `resetting` → `required` | Must match the current operation. Repeating the same completion is accepted. |
| `password_gate_begin_change(user, op)` | `required` → `changing` | Needs an existing `required` row and a new operation ID. Accounts with no row cannot start a change. |
| `password_gate_cancel_unattempted_change(user, op)` | `changing` → `required` | Only before any Auth password mutation was sent. After an ambiguous Auth response this must not be used. |
| `password_gate_finish_change(user, op)` | `changing` → `cleared` | Must match the current operation. Repeating the same completion is accepted. The caller must have verified the Auth change. |
| `password_gate_admit_session(user, session, generation)` | none (writes admitted row) | Requires `cleared`, the generation still current, an active account, and a live session created **after** completion. A null `created_at` fails closed. |

### Deliberate differences from the research prototype

- **No profile writes.** The prototype's `finish_password_change` wrote `must_change_password` and `password_changed_at`. Phase 1 does not. Those flags stay under the existing handlers until Phase 2, so this migration cannot change current behaviour.
- **No automatic initialization.** Existing accounts have no state row. They are not gated, and nothing treats them as trustworthy. Reconciliation is Phase 4.
- **Admission is included** because the admitted-session table needs a service-only writer. Nothing reads that table for access decisions in Phase 1.

## Verification

Synthetic PGlite (every migration in order, synthetic Auth tables). 63 tests across three files pass, including the existing full-schema and flag-guard suites:

- Both tables: RLS on, zero policies, zero table privileges for `anon`, `authenticated` and `service_role`. The six functions: executable by `service_role` only, with `PUBLIC` checked through the ACL.
- Nothing in an existing policy or function references `password_gate`.
- Signed-in general user and `anon` are denied direct reads and calls.
- Reset lifecycle, change lifecycle, and admission rules: each transition, each refusal, repeated acknowledgements, stale completions, unknown profiles, expired sessions, a session created before completion, a wrong generation, another user's session, and cascade on session delete.
- Profile flags (`must_change_password`, `password_changed_at`) are unchanged after every step.
- Rollback: inside a transaction, the rollback removes exactly the new objects; the transaction is then rolled back and the objects are restored.

Real concurrency: disposable PostgreSQL 17.11 (temporary cluster under `/tmp`, Unix socket only, removed afterwards), script `artifacts/itam/scripts/test-password-gate-concurrency.mjs`. All five checks pass:

1. 24 racing reset starts for one account: exactly one in-progress operation.
2. 24 racing change starts from `required`: exactly one change.
3. 40 races between a stale reset completion and a new reset: the new operation is never cleared.
4. An admission waits behind a reset holding the account lock (confirmed by `pg_stat_activity` wait state), then is refused under the new operation.
5. 16 identical concurrent admissions store exactly one row.

Mutation check: with the stale-completion operation check removed from `finish_reset`, check 3 fails (round 36). The migration was then restored and the script passed again. The file hash matches the reviewed copy (`162bd9de…`).

Typecheck exit 0. Full `@workspace/itam` unit suite: 31 files, 281 tests passing.

**Not verified:** hosted GoTrue, PostgREST or Realtime behaviour; the `auth.sessions` column types on the hosted project (`created_at` is nullable there, and the function fails closed on null); any Edge Function. The sandbox cannot reach `supabase.co`.

## Rollback

`supabase/rollbacks/20261101000024_password_gate_infrastructure.sql` drops the six functions and both tables. Safe only if **no row is `resetting` or `changing`** and no Phase 2 handler calls these functions. Check first:

```sql
SELECT phase, count(*) FROM public.password_gate_state GROUP BY phase;
```

If any row is `resetting` or `changing`, stop. That operation has an unknown Auth outcome and needs a separate recovery procedure before anything is dropped. Dropping the tables deletes the state and admitted-session rows.

## What Phase 1 does not do

- No handler, frontend or Edge Function calls these functions. `change-password`, `reset-password` and `create-user` are unchanged.
- No enforcement: policies and business data are unchanged, so flagged sessions can still reach the database directly until Phase 3.
- No broker. The admission function trusts the service to verify the session and password.
- No cron, purge or stuck-operation recovery. Those belong to Phases 2 and 4.

## Decision needed

Approve applying `20261101000024` to production, with the SQL and rollback above, as a new live migration. Phase 2 needs its own review and approval.
