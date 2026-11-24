# Trusted password gate, Phase 4: recovery runbook (DRAFT, not applied)

Status (2026-11-24): **drafted, not applied to any database.** Proposal: `supabase/proposals/password-gate/phase4-recovery.sql`. Rollback: `supabase/proposals/password-gate/phase4-recovery-rollback.sql`. Local test: `artifacts/itam/src/lib/password-gate-recovery.local.test.ts` (12 tests, passing on PGlite, applied after every repository migration).

This closes the Phase 2 stranded-account rows that say **None (Phase 4)**, so an account is not locked forever. It does not close the Phase 3 gate, and it does not replace the Option B risk acceptance in `docs/password-gate-phase2-review.md` (line 94). Until this is applied to production, that acceptance still stands.

## What the procedure can and cannot do

- It moves one account from `resetting` or `changing` to `required`, under a new operation ID, after a 15-minute quiet period. It removes that account's admitted sessions and sets `must_change_password = true`. It writes one row to `password_gate_recovery_log`.
- It does **not** change a password, an Auth record, a policy, or a grant.
- The account is then recovered by the normal administrator **Reset password** action, which is allowed from `required`. That action issues a temporary password through the reviewed Phase 2 path. There is no standing bypass.
- It refuses `required`, `cleared`, and "no gate row". A flagged account with no row is already recoverable by admin reset (Phase 2 table), so it does not need this function.

## Stop conditions (do not run if any is true)

- The account's gate row is not exactly the phase and operation you read. The function enforces this, but check first.
- The gate changed within 15 minutes. Wait. An operation may still be running.
- The Edge Function logs for this account show a request still in flight.
- You have not confirmed the account is not the retained administrator (`theneilcruz@gmail.com`, decision D4). Do not use it for tests, and do not recover it through this path without a separate decision.

## Procedure (per account, after approval)

1. **Read-only check.** Record the current state:

   ```sql
   SELECT p.email, p.is_active, p.must_change_password, g.phase, g.operation_id, g.updated_at
   FROM public.profiles p
   LEFT JOIN public.password_gate_state g ON g.user_id = p.id
   WHERE p.id = '<user uuid>';
   ```

   Stop unless `phase` is `resetting` or `changing` and `updated_at` is more than 15 minutes ago.

2. **Recover** (service role or SQL editor, one account per call):

   ```sql
   SELECT public.password_gate_recover_account(
     '<user uuid>', '<phase from step 1>', '<operation_id from step 1>',
     gen_random_uuid(), '<operator email>', '<reason, for example: stranded after ambiguous reset, ticket ref>');
   ```

3. **Confirm.** Re-run the query in step 1. Expect `phase = required`, `must_change_password = true`, and no rows in `password_gate_admitted_sessions` for that user.

4. **Reset.** From the administrator UI, run **Reset password** for the account. Give the temporary password to the user through the usual channel. The account is now the same as any other account that was reset with the gate on.

5. **Record.** Note the recovery log row id, the reset time, and the ticket reference in the deployment record.

## Notes for the risk decision

- **Ambiguous Auth outcome.** For a `changing` account, the Auth password may already have changed, or may not. Recovery does not need to know which. The admin reset in step 4 sets the password again, so the outcome of the earlier attempt does not matter.
- **Sessions.** Recovery removes the gate's admissions only. It does not end Auth sessions. Whether the admin reset ends existing Auth sessions has not been verified in this review; check it before relying on step 4 to cut off a live session. Enforcement (Step 3.4) has not been turned on, so this is not yet a control.
- **Audit.** The log is service-only and not readable by client roles. Its rollback refuses while rows exist, so applied recoveries cannot be removed by rollback.

## Apply and rollback

- Apply: one approval per apply, to production. Test on PGlite first (done). Confirm the rollback is current.
- Rollback: `phase4-recovery-rollback.sql`. It refuses while `password_gate_recovery_log` has rows. Undo a recovery per account with the admin reset, not by deleting log rows.
