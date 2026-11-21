# Trusted password gate: phased review (2026-11-21)

Status: **not implemented.** This is a review of `docs/trusted-password-gate-design.md`, with a phased plan. It changes no production state and authorizes none.

## What is in production now

- `00022` (applied as `20261121090050`): authenticated users cannot write `must_change_password` or `password_changed_at` directly through the Data API.
- `change-password` (live v1): checks the current password, changes the Auth password, signs out globally, and clears the flag last. A failure after the Auth change leaves the flag set.
- `reset-password` (live v5) and `create-user` (live v4): set the flag, then perform the Auth step, and report `profileFlag` and `unverified` session revocation. Deployed from repo `b5cf1cb` on 2026-11-21.
- Read-only, 2026-11-21: 0 of 15 profiles flagged.

## What this does not protect

The flag is only read by the app. A user who has a flagged or temporary-password session can still call PostgREST, Realtime and the exposed security-definer RPCs. The design identifies seven exposed security-definer functions in the read-only catalog check, including `get_my_role()` and `is_active_user()`, which the RLS policies depend on. None of them checks the flag. Access tokens stay valid until expiry after a reset.

## Why it cannot be finished in this sandbox

The design lists what must be proven against hosted Auth: whether an admin password update revokes other sessions on this Auth version (not verified), whether `auth.sessions.created_at` can be null (the experiment fails closed on it), and how GoTrue behaves under concurrent resets and sign-ins. The sandbox cannot reach `supabase.co`, and there is no staging project. These need signed-in tests with dedicated accounts, run by you or with your approval.

## Phased plan (each phase needs its own approval)

**Phase 0: decisions (no production change).**
- Scope: gate all business data, as the design requires, or only writes. The design recommends all data.
- Inventory: confirm every table policy, view, RPC, trigger and Edge Function that touches business data. The design's seven-function list is point-in-time.
- Retained administrator: exempt from the gate only through a documented, tested recovery path. Do not lock it out.

**Phase 1: non-enforcing infrastructure (one migration, no policy change).**
- New service-only tables for gate state and admitted sessions, plus service-only RPCs to start, complete and cancel operations.
- Rollback: drop the new objects. No existing policy depends on them.
- Tests: PGlite and disposable PostgreSQL, including concurrent starts and stale completions.

**Phase 2: compatible handlers and frontend (non-enforcing).**
- `change-password`, `reset-password` and `create-user` call the Phase 1 RPCs.
- Frontend uses the server path only.
- Tests: real signed-in runs with dedicated accounts. Mocked tests are not sufficient.

**Phase 3: enforcement.**
- Restrictive RLS on business tables and the exposed definer functions. Session admission checked against `auth.sessions`.
- Rollback: a reviewed SQL script that restores the current policies, tested before the change.
- Tests: role matrix for admin, support, general user, flagged user, retained admin, and an old session after reset.

**Phase 4: initialization and recovery.**
- Reconcile existing accounts. Do not assume an unflagged account is trustworthy.
- A tested procedure for stuck or ambiguous operations, run by an administrator.

## Risks to keep in view

- Lockout of the retained administrator if Phase 3 is wrong.
- Reciprocal administrator resets can deadlock.
- A lost Auth response can leave an account locked. The design says not to guess success.
- The admission broker holds a privileged credential. A compromised service can defeat the design.
- Database administrators and the service role bypass RLS by design.

## Decisions needed from you

1. Confirm the scope in Phase 0: all business data (recommended by the design) or writes only.
2. Name the dedicated test accounts for Phase 2 signed-in tests. Do not use the retained administrator for tests.
3. Approve Phase 0 and the Phase 1 design review. Phases 1 to 4 each need separate approval; they cannot be done in one step.

## Phase 0 decisions (recorded 2026-11-21)

- **Scope:** the gate covers **all business data**, as the design recommends. Writes-only was rejected, because flagged sessions could still read tickets, assets and profiles directly.
- **Phase 0 approved** by the user. This records decisions only. No production change was made, and no Phase 1 work has started.
- **Phase 1** (non-enforcing migration) needs its own design review and approval. Phases 2 to 4 each need separate approval.
- **Still open for Phase 2:** the dedicated test accounts. Do not use the retained administrator. The user-operated plan (`docs/user-operated-signed-in-test-plan.md`) lists three dedicated accounts; confirm they are the ones to use.
- **Not implemented:** the gate itself. Until Phase 3, the flag is enforced only in the app.


## Phase 1 status (2026-11-21)

Phase 1 is built and tested locally: migration `20261101000024`, its rollback, PGlite tests, and a real-concurrency script on disposable PostgreSQL 17.11. It is **not applied to production**. The SQL, rollback and test results are in `docs/password-gate-phase1-review.md`, which needs your approval before any production change.

## Phase 2 status (2026-11-21)

Phase 2 is built and tested locally, and committed to the branch. It is **not deployed**. The handlers call the Phase 1 functions (`change-password`, `reset-password`, `create-user`), and the frontend shows the new refusal and locked-account warnings. Review, the stranded-account table, and deployment decisions are in `docs/password-gate-phase2-review.md`.
