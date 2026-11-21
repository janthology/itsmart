# Password-flag guard: review package (migration 20261101000022)

Status: **prepared locally, NOT applied to production, NOT deployed.**

## What it changes
1. `REVOKE UPDATE ON public.profiles FROM authenticated`, then re-grants UPDATE only on `role`, `full_name`, `department`, `is_active`. These are the only columns the client writes (`queries/users.ts`, register upsert in `auth-context.tsx`).
2. Adds `trg_guard_profile_password_flags`: rejects direct API changes (`current_user` is `authenticated` or `anon`) to `must_change_password` or `password_changed_at`. It does not block SECURITY DEFINER functions or service-role writes.

Effect on production (once applied): a signed-in user can no longer clear their own mandatory-password flag through the Data API. Admin role/active changes, profile name/department edits and register are unaffected.

## Ordering constraint (important)
`src/pages/change-password.tsx` currently writes `must_change_password` and `password_changed_at` directly. **Applying this migration before the change-password path is replaced will block completion for every flagged account.** Required order:
1. Deploy the server-side change-password Edge Function `supabase/functions/change-password` (written and locally tested; **not deployed**).
2. Ship the frontend that calls it, to Vercel **preview** and test it with the dedicated test accounts.
3. Get explicit approval to promote the frontend to production (currently on hold).
4. Only then apply migration 00022 to production.

## Not yet solved
- The guard alone does not prove a password changed. The `change-password` function verifies the current password, changes it with the verified session, revokes sessions, and only then clears the flag. It has no "finish later" mode, because that would let someone who knows a temporary password clear the flag without changing it.
- If the flag clear fails after the Auth change, the flag stays set and the next sign-in is forced through the change again. Repair needs an administrator or a reviewed SQL step; this is documented, not automated.
- Existing accounts still get the flag from the legacy reset path; `reset-password` and `create-user` use the service role and are not deployed.
- Already-issued access JWTs remain valid until expiry, and the database does not yet refuse business data to flagged sessions. The function does not provide full session admission.
- The change-password browser page still writes the flag directly until the frontend is switched to the function.
- Admin `updateUser` logs out all sessions in GoTrue (from the public source, v2.198.0). The live Auth version and behavior are unverified. The retained administrator must not be forced through a flow that locks them out.

## Rollback
`supabase/rollbacks/20261101000022_profile_password_flag_guard.sql` drops the trigger and function and restores the table-level `GRANT UPDATE ON public.profiles TO authenticated`. Rollback restores the bypass; use it only if a flagged user is blocked and no other fix is available. Rollback does not change any row.

## Local verification
- `artifacts/itam/src/lib/profile-password-flag-guard.local.test.ts` (7 tests): direct flag writes blocked; trigger blocks writes alone when grants are widened (fails on the old SECURITY DEFINER version); name/department edits allowed; admin role/active changes allowed; service path allowed; SECURITY DEFINER completion path allowed; rollback restores the previous grant.
- Full repository migration suite and typecheck pass (197 tests).
- `artifacts/itam/src/lib/change-password-edge.test.ts` (25 tests): runs the real function source with mocked Auth/REST calls. Covers validation before upstream calls, wrong-password and outage handling, no retry of the Auth change, session revocation before flag clear, service-role scoping, and no secrets in responses.
- The synthetic PostgreSQL run does not exercise GoTrue, PostgREST, Realtime or the hosted grants. The mocked function tests do not prove real GoTrue behavior, such as whether a password update revokes other sessions.
