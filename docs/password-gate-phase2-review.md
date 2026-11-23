# Trusted password gate, Phase 2: compatible handlers (review package)

Status (2026-10-28): **Edge Functions deployed to production; frontend preview built; production promotion and signed-in tests pending.** Deployed: `change-password` v2, `reset-password` v6, `create-user` v5 (all `verify_jwt` false, all ACTIVE). Source for each was read back from Supabase and matches `7cc9da1` (change-password checked in full; the other two were deployed from the same file contents and not re-read). Phase 1 gate RPCs (`password_gate_begin_change`, `password_gate_cancel_unattempted_change`, `password_gate_finish_change`, `password_gate_begin_reset`, `password_gate_finish_reset`) confirmed present in the live database, `(p_user uuid, p_operation uuid)`. `csp-report` was not changed.

Phase 2 is defined in `docs/trusted-password-gate-review.md`: `change-password`, `reset-password` and `create-user` call the Phase 1 functions, and the frontend uses the server path only. Phase 1 (`20261101000024`, applied as `20261121174713`) is the prerequisite.

## Decisions applied (your answers, 2026-11-21)

- **Ambiguous reset:** an account whose reset outcome is unknown stays locked until Phase 4 recovery exists. No administrator override.
- **Flagged account with no gate lock:** `change-password` refuses it (`403 change_unavailable`). Only unflagged accounts continue on the existing path.

## What each function does now

### `change-password`

1. Caller from bearer token; active profile (unchanged).
2. **Take the gate lock** with `password_gate_begin_change` (new operation ID), before any credential check.
   - Lock acquired: the change is gated.
   - Lock refused and the account is flagged: stop with `403 change_unavailable`. Nothing changes.
   - Lock refused and the account is unflagged: continue on the existing path, without gate state.
   - Lock response lost: stop with `503 operation_unconfirmed`. Nothing is sent to Auth, and the lock is not released, because it may be held.
3. Verify the current password (unchanged).
   - Wrong password, verification outage, or a thrown request: release the lock with `password_gate_cancel_unattempted_change`, then return the existing code. If the release fails, return `503 operation_unconfirmed`.
4. Change the password, global logout (unchanged). **From here on the lock is never released automatically.**
5. `password_gate_finish_change` marks the operation complete. Failure returns `503 completion_unconfirmed`, and the lock stays held.
6. Clear the flag last (unchanged). Failure returns `503 completion_unconfirmed`.

### `reset-password`

1. Admin check and self-reset guard (unchanged).
2. **Set the flag first** (unchanged code). A failed flag write returns `503 profile_unconfirmed`, takes no lock, and changes nothing in Auth. This ordering is why a failed flag write does not strand the account.
3. `password_gate_begin_reset`.
   - Refused (another operation is in progress, or the profile is unknown): `409 reset_unavailable`. No Auth change.
   - Lost response: `503 reset_unconfirmed`. No Auth change. The account may now be locked.
4. Auth password change (unchanged). Failure returns `503 reset_unconfirmed`. The lock stays held.
5. `password_gate_finish_reset`. The new password is still returned if this fails, with `gateConfirmed: false`. The account then stays locked until recovery.
6. Second flag check (unchanged). Response includes `gateConfirmed` and `profileFlag`.

### `create-user`

1. Unchanged up to the profile upsert and its confirmation.
2. `password_gate_begin_reset` then `password_gate_finish_reset` record the gate state for the new account.
3. If either fails, return `503 gate_unconfirmed` with the `userId` and **no temporary password**. The Auth account is not deleted. Recovery is "Reset password" for that account.
4. Otherwise return the temporary password, as before.

## Accounts that can be stranded (Phase 4 recovery is needed)

No automatic recovery exists yet. The lock states below are intentional under the "stay locked" decision.

| Situation | Gate state | Effect | Recovery now |
| --- | --- | --- | --- |
| Reset: lock response lost | `resetting` or none | Admin reset refused until resolved | None (Phase 4) |
| Reset: Auth change unconfirmed | `resetting` | User refused, admin reset refused | None (Phase 4) |
| Reset: finish failed after Auth | `resetting` | Password returned with warning; user refused | None (Phase 4) |
| Change: Auth change or logout unconfirmed | `changing` | User refused, **admin reset refused** | None (Phase 4) |
| Change: gate completion failed | `changing` | Same as above | None (Phase 4) |
| Change: flag clear failed after completion | `cleared`, flag set | User refused (flagged, not `required`) | Admin reset works from `cleared` |
| Create: gate step failed | none, or `resetting` | No password issued; flagged account | Reset works if no row; otherwise None |

The rows that say **admin reset refused** are the most serious. They are the reason the Phase 4 recovery procedure must exist before Phase 2 is deployed to production, or the risk must be accepted in writing.

## Frontend

- `artifacts/itam/src/lib/change-password-outcome.ts`: `change_unavailable` is a safe rejection with its own message. Other codes keep their existing handling. Unknown codes still fail closed.
- `artifacts/itam/src/pages/admin/users.tsx`: `reset_unavailable` gets its own warning, and a reset that returns `gateConfirmed: false` shows a locked-account warning with the password still displayed.

No other UI change. The app already forces flagged users to the change page (`App.tsx`), and the change page already calls `change-password` through the Supabase function client.

## Verification (local only)

- `change-password-edge.test.ts`: 25 original tests, updated for the gate RPC calls, plus 10 new tests for the gate:
  - lock before verification; refusal for flagged accounts; continuation for unflagged accounts;
  - lost lock response releases nothing;
  - the lock is released before any Auth change after a wrong password or verification outage;
  - a failed release is reported as unconfirmed;
  - no release after the Auth change starts;
  - completion after revocation and before the flag clear;
  - completion failure leaves the flag set.
- `edge-functions.security.test.ts`: reset and create tests updated for the new call order, plus 8 new gate tests (refusal, lost lock, flag-first ordering, gate failure after Auth success, create withholding the password).
- `change-password-outcome.test.ts`: `change_unavailable` classified as rejected; gate-unconfirmed codes classified as ambiguous.
- Full `@workspace/itam` suite: 31 files, 301 tests passing. Typecheck exit 0.
- Strict type check of the three function files (Deno globals excluded): clean.

**Not verified:**

- PostgREST's HTTP status for a raised exception. The code treats only HTTP 400 as "refused" and everything else as "unknown", which is the safe direction. If PostgREST returns 500 for these, unrelated failures will look like "unknown" and lock accounts. The live test must confirm the status.
- The functions were tested with mocked fetch, not against live GoTrue, PostgREST or the database.
- Real signed-in behaviour: concurrent admin resets and self-changes, old sessions after a reset, and the flag-first race. These need the dedicated accounts.

## Deployment plan and record

### Accepted risk (recorded 2026-10-28)

The owner chose to deploy Phase 2 now, before Phase 4 recovery exists (the "Option B" above). Accepted: an account can be left in the `changing` or reset-locked state after a failed Auth step. Admin reset is refused for such accounts. Recovery is by direct database work, under the owner's direct approval, until Phase 4 is built. No retry or override is provided in the meantime.

### Record

- 2026-10-28: `change-password` v1 to v2, `reset-password` v5 to v6, `create-user` v4 to v5. Prior versions are rollback targets.
- Frontend preview (Vercel `dpl_6fjeLyKmbNY62i6H3wdRr1gWuuuM`) built READY from `7cc9da1`.
- Not yet done: production promotion of the frontend, signed-in tests on the three dedicated accounts.

### Plan (as approved)

1. Edge Functions, `verify_jwt` false: done (see Record).
2. Frontend: the two small UI changes, through the normal Vercel preview and then production promotion, with the same approval as before.
3. No new migration in this phase.
4. Rollback: redeploy the previous function source (`git show d6689e4:supabase/functions/<name>/index.ts`) and the previous frontend deployment. Existing gate rows do not affect the old code, which never reads them.

## Decisions (resolved)

1. **Deploy Phase 2 now, or first?** Resolved: deploy now (Option B).

The original options are kept below for the record.

1. **Deploy Phase 2 now, or first?** Option A: deploy after the Phase 4 recovery procedure is designed and tested, which is the safe default. Option B: deploy now and accept that admin reset is refused for accounts in the `changing` state, with recovery by direct database work.
2. **Dedicated test accounts.** The three accounts you created (administrator, support, general user) can be used for the signed-in tests after deployment. Confirm they are the ones to use, and that no existing person's account is involved.
3. **Signed-in tests.** After deployment, run: flagged general user change; wrong password; forced reset of the support account, then the old password is rejected; reset with a concurrent change; an admin trying to reset a user mid-change. Each one needs your approval to create or change those dedicated accounts.
