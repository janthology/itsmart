# Password-flag guard: review package (migration 20261101000022)

Status (updated 2026-11-21):
- **Migration applied** to production (`DOST02-ITSMART`, `rkwxdqludtdzbpuftsvi`) as version `20261121090050 profile_password_flag_guard`. The SECURITY INVOKER version is live; the explanatory header comments were shortened, and no SQL statement changed.
- **Frontend promoted:** production `dpl_783iuKSmLzHcxzyf7XmMJA1KEima` at `15154ff`. Rollback target `dpl_F4exUtaVQX8WdTidmW93jC8DWMcw` (`a8e7204`).
- **Edge Function `change-password`:** live, ACTIVE, version 1, `verify_jwt` false.
- **Verified live:** one password change end to end on `test4@gmail.com` (synthetic). The flag was cleared after the change. Read-only checks cannot confirm which server path cleared it.
- **Verified in CI:** browser e2e (`e2e-smoke`) passed on `672b813` (run `44897902791`).
- **Trigger probe:** a rollback-only probe as `authenticated` confirmed direct flag writes are blocked and own-name updates are allowed.
- **Not verified:** a second live account; the production preview behind Vercel SSO; repo-to-live match of `create-user` and `reset-password`.

The "Ordering constraint" below was the pre-apply plan. Its steps are now complete.

## What it changes
1. `REVOKE UPDATE ON public.profiles FROM authenticated`, then re-grants UPDATE only on `role`, `full_name`, `department`, `is_active`. These are the only columns the client writes (`queries/users.ts`, register upsert in `auth-context.tsx`).
2. Adds `trg_guard_profile_password_flags`: rejects direct API changes (`current_user` is `authenticated` or `anon`) to `must_change_password` or `password_changed_at`. It does not block SECURITY DEFINER functions or service-role writes.

Effect on production (once applied): a signed-in user can no longer clear their own mandatory-password flag through the Data API. Admin role/active changes, profile name/department edits and register are unaffected.

## Ordering constraint (pre-apply plan, now complete)
`src/pages/change-password.tsx` currently writes `must_change_password` and `password_changed_at` directly. **Applying this migration before the change-password path is replaced will block completion for every flagged account.** Required order:
1. Deploy the server-side change-password Edge Function `supabase/functions/change-password` (written and locally tested; **not deployed**).
2. Ship the frontend that calls it, to Vercel **preview** and test it with the dedicated test accounts.
3. Get explicit approval to promote the frontend to production (done: `dpl_783iuKSmLzHcxzyf7XmMJA1KEima`).
4. Only then apply migration 00022 to production (done: `20261121090050`).

## Not yet solved
- The guard alone does not prove a password changed. The `change-password` function verifies the current password, changes it with the verified session, revokes sessions, and only then clears the flag. It has no "finish later" mode, because that would let someone who knows a temporary password clear the flag without changing it.
- If the flag clear fails after the Auth change, the flag stays set and the next sign-in is forced through the change again. Repair needs an administrator or a reviewed SQL step; this is documented, not automated.
- Existing accounts still get the flag from the legacy reset path. `reset-password` (v4) and `create-user` (v3) are ACTIVE in production, use the service role, and their repo-to-live match is unverified.
- Already-issued access JWTs remain valid until expiry, and the database does not yet refuse business data to flagged sessions. The function does not provide full session admission. The post-change global logout was not directly observed (`0 sessions` after the test change, read-only).
- The change-password browser page was switched to the function (`73bf9ff`). The 'writes the flag directly' concern is resolved.
- Admin `updateUser` logs out all sessions in GoTrue (from the public source, v2.198.0). The live Auth version and behavior are unverified. The retained administrator must not be forced through a flow that locks them out.

## Rollback
`supabase/rollbacks/20261101000022_profile_password_flag_guard.sql` drops the trigger and function and restores the table-level `GRANT UPDATE ON public.profiles TO authenticated`. Rollback restores the bypass; use it only if a flagged user is blocked and no other fix is available. Rollback does not change any row.

## Local verification
- `artifacts/itam/src/lib/profile-password-flag-guard.local.test.ts` (7 tests): direct flag writes blocked; trigger blocks writes alone when grants are widened (fails on the old SECURITY DEFINER version); name/department edits allowed; admin role/active changes allowed; service path allowed; SECURITY DEFINER completion path allowed; rollback restores the previous grant.
- Full repository migration suite and typecheck pass (197 tests).
- `artifacts/itam/src/lib/change-password-edge.test.ts` (25 tests): runs the real function source with mocked Auth/REST calls. Covers validation before upstream calls, wrong-password and outage handling, no retry of the Auth change, session revocation before flag clear, service-role scoping, and no secrets in responses.
- Browser e2e (`artifacts/itam/e2e/role-pages.spec.ts`): 61 passed locally (Chromium 131, production build) and in CI on `672b813`. Two stale recovery cases that mocked the old direct update path were removed.
- The synthetic PostgreSQL run does not exercise GoTrue, PostgREST, Realtime or the hosted grants. The mocked function tests do not prove real GoTrue behavior, such as whether a password update revokes other sessions.
