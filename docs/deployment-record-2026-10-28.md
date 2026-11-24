# Deployment record: 2026-10-28

Branch: `arena/fbb1e145-itsmart`. Frontend commit: `73bf9ff`. Edge Function source: `supabase/functions/change-password/index.ts`.

This record lists what changed outside Git on 2026-10-28, what was held back, and how to roll each change back. It is an inventory, not a backup.

## Changes made

| Target | Object | State | Scope confirmed by user |
| --- | --- | --- | --- |
| Supabase `DOST02-ITSMART` (`rkwxdqludtdzbpuftsvi`) | Edge Function `change-password` (id `9f58af79-c160-4b4c-a793-9446699c6dd8`) | ACTIVE, version 1, `verify_jwt` false. Body equals committed `index.ts`. | Keep live (user answer, 2026-10-28). Live behavior **not verified**; the sandbox cannot reach `supabase.co`. |
| Vercel `itsmart-dost02` | Preview deployment `dpl_9uP6zJDTksMkZkcaCbUzHFjmqjJX` from `73bf9ff` | READY, not promoted. Behind Vercel login. | Keep preview (user answer, 2026-10-28). |

## Held back (not deployed)

- **Production frontend promotion.** Production remains `dpl_F4exUtaVQX8WdTidmW93jC8DWMcw`. Held until the browser e2e suite runs and the live Edge path is verified (user answer, 2026-10-28).
- **Migration `20261101000022_profile_password_flag_guard.sql`.** Not applied. Must ship after the frontend change-password path is live. Applying it earlier blocks mandatory password changes for flagged accounts.
- Pre-existing functions `create-user` (v3) and `reset-password` (v4) were **not modified**. Whether their live code matches the repo is unverified.

## Rollback

- **Edge Function `change-password`:** delete the function `change-password` from `DOST02-ITSMART`. No other function depends on it. Nothing in production calls it until the frontend is promoted.
- **Vercel preview:** delete deployment `dpl_9uP6zJDTksMkZkcaCbUzHFjmqjJX`. Production is unaffected.
- **Migration `00022`:** not applied, so there is nothing to roll back yet. Once applied, its rollback is `supabase/rollbacks/20261101000022_profile_password_flag_guard.sql`. That restores direct `UPDATE` on `profiles` for `authenticated`. Use it only if the change-password path breaks.

## Known gaps

- Commit `fd0e44b` has the message "(not deployed)". The function is now live. The message was not rewritten, to avoid history rewrites.
- Unverified: GoTrue password grant for a flagged user; whether `logout?scope=global` revokes the verification session; whether the live `create-user` and `reset-password` code matches the repo.
- Browser e2e (`e2e/role-pages.spec.ts`) has not run. The Playwright browser download failed in the sandbox.

## Verification at `73bf9ff`

- `vitest run`: 29 files, 240 tests passing. Includes `change-password-edge.test.ts` (25) and `profile-password-flag-guard.local.test.ts` (6).
- `tsc --noEmit -p .`: exit 0.
- `vite build`: exit 0.

## Update 2026-11-21: migration 00022 applied

- **Live migration:** applied to `DOST02-ITSMART` as `20261121090050 profile_password_flag_guard`. The SQL matches `supabase/migrations/20261101000022_profile_password_flag_guard.sql` at commit `15154ff`, except that the explanatory header comments were shortened. No SQL statement changed.
- **Trigger:** `guard_profile_password_flags` is `SECURITY INVOKER`. Its `trg_guard_profile_password_flags` trigger is enabled. The earlier `SECURITY DEFINER` version was a no-op (see `15154ff`).
- **Grants:** `authenticated` no longer has table-level `UPDATE` on `profiles`. Column grants are `role`, `full_name`, `department`, and `is_active`.
- **Probe:** a rollback-only probe as `authenticated` showed a direct write to `must_change_password` is blocked, and an own-name update is allowed. The probe always raised, so nothing was committed.
- **Frontend:** production is `dpl_783iuKSmLzHcxzyf7XmMJA1KEima`, built from `15154ff`, promoted over the previous `dpl_F4exUtaVQX8WdTidmW93jC8DWMcw`. Rollback of the frontend is redeploying `dpl_F4exUtaVQX8WdTidmW93jC8DWMcw` to production.
- **Flagged account:** one active general user still has `must_change_password = true`. The password change is not yet verified end to end.
- **Rollback of 00022:** `supabase/rollbacks/20261101000022_profile_password_flag_guard.sql`. It restores table-level `UPDATE` for `authenticated`. Use only if the change-password path breaks.
- **Still unverified:** the live `change-password` function has not been exercised with a real account. Browser e2e has not run.

## Update 2026-11-21: first end-to-end password change and browser suite

- **Account test4@gmail.com** (synthetic test user, `ORD`): admin reset ran at 10:20:57 UTC. The reset response warned that the flag could not be confirmed, but the database showed `must_change_password = true`. The user then signed in and changed the password. After the change, the database showed `must_change_password = false` and `password_changed_at` set (10:24:19 UTC). This is one live run, not a full test. The Edge Function logs were not readable from the sandbox, so which server path cleared the flag was not directly confirmed.
- **Browser e2e:** the previous CI `e2e-smoke` job failed on `2edfa7a`. Two tests in `artifacts/itam/e2e/role-pages.spec.ts` still mocked the old direct profile-update recovery path, which the page no longer uses. I removed those two cases (the 403 and no-row variants). The replacement cases (review marker, success, wrong password, label association) remain. Local run against the production build with Chromium 131: 61 passed, 0 failed. The sandbox has no Playwright Chromium download, so the local run used a Chromium binary from npm (`@sparticuz/chromium`).

## Reconciliation 2026-11-21: current state

This section supersedes the "Held back" and "Known gaps" text above, which describe the state on 2026-10-28. The earlier text is kept as history.

- **Production frontend:** `dpl_783iuKSmLzHcxzyf7XmMJA1KEima` at `15154ff`, promoted. Rollback target: `dpl_F4exUtaVQX8WdTidmW93jC8DWMcw` (commit `a8e7204`).
- **Migration `00022`:** applied as `20261121090050`. Rollback: `supabase/rollbacks/20261101000022_profile_password_flag_guard.sql`.
- **Live migration history** (`list_migrations` on `rkwxdqludtdzbpuftsvi`, read-only) ends with `20261120203219 sla_recipient_reopen_cycle` and `20261121090050 profile_password_flag_guard`. Migrations `00018` and `00020` are live under versions `20261120083024` and `20261120133730`. `00017`, `00019`, and `00021` are not applied.
- **Edge Function `change-password`:** ACTIVE, version 1, `verify_jwt` false. Still in use by production.
- **`create-user` (v3) and `reset-password` (v4):** not modified. The repo-to-live match is still unverified.
- **Browser e2e:** runs in GitHub CI `e2e-smoke`. The run on `672b813` passed (run `44897902791`). The earlier "has not run" statements are superseded.
- **Flagged account:** `test4@gmail.com` was cleared by the first live password change on 2026-11-21. A read-only check now shows 0 of 15 profiles flagged and 13 active. The earlier flagged-count figures in the notes are not reliable for the pre-reset state. The "one active general user still has the flag" line in the 2026-11-21 update is superseded.
- **Still unverified:** a second live password change on a different account; the production Vercel deployment behind SSO; which server path cleared the flag on `test4@gmail.com`.

## Read-only check 2026-11-21: live Edge Function source versus repo

Read with `get_edge_function` on `rkwxdqludtdzbpuftsvi`. Nothing was deployed or changed.

- **`reset-password` live v4** (updated 1793354091559): sets the password first, then the profile flag, then makes a best-effort session-delete call. It has no self-reset guard, and it returns a 500 if the flag write fails after the password change. **Does not match the repo.** The repo version (`supabase/functions/reset-password/index.ts`) sets and confirms the flag before touching Auth, refuses self-reset, returns `profileFlag` and `sessionRevocation: "unverified"`, and reports `reset_unconfirmed`.
- **`create-user` live v3** (updated 1793354108362): creates the Auth user, writes the profile, and deletes the Auth user on profile failure. It has no profile confirmation and no cleanup-unconfirmed handling. **Does not match the repo.** The repo version confirms the profile and reports `creation_unconfirmed`, `cleanup_requested` and `cleanup_unconfirmed`.
- **`change-password`**: live v1 matches the committed source (checked earlier).

Consequence: the live `reset-password` and `create-user` are older than the repo code. Deploying the repo versions is a separate approval, after tests. Do not treat the repo as deployed. See `docs/pilot-data-wipe-plan.md`, section 8.

## Deployment 2026-11-21: repo versions of reset-password and create-user

Approved by the user on 2026-11-21 ("deploy the repo versions").

- **`reset-password`:** live v4 → **v5**, ACTIVE, `verify_jwt` false. Source: `supabase/functions/reset-password/index.ts` at `b5cf1cb`.
- **`create-user`:** live v3 → **v4**, ACTIVE, `verify_jwt` false. Source: `supabase/functions/create-user/index.ts` at `b5cf1cb`.
- **Verification before deploy:** `edge-functions.security.test.ts`, `password-gate-reset-edge.prototype.test.ts` and `change-password-edge.test.ts` passed, 71 tests, against the repo source. These use mocked fetch.
- **Verification after deploy:** the live bodies from `get_edge_function` were written to scratch files and compared with the repo files. Both are identical.
- **Frontend compatibility:** production `dpl_783iuKSmLzHcxzyf7XmMJA1KEima` (`15154ff`) already handles the new codes and fields (`self_reset_forbidden`, `profile_unconfirmed`, `reset_unconfirmed`, `profileFlag`, `creation_unconfirmed`, `cleanup_requested`, `cleanup_unconfirmed`).
- **Not verified:** a live call through Auth. The sandbox cannot reach `supabase.co`. No test user was created, reset or changed. No data was written.

**Rollback reference (exact previous live source).** The previous live bodies match commit `c6f746c` on every distinctive marker. The match is by marker, not byte-for-byte, because the previous live body was not hashed. To roll back, redeploy:
- `reset-password`: `git show c6f746c:supabase/functions/reset-password/index.ts` (224 lines), `verify_jwt` false.
- `create-user`: `git show c6f746c:supabase/functions/create-user/index.ts` (247 lines), `verify_jwt` false.

Rollback restores the known gaps listed above (password set before flag; no self-reset guard; undocumented session-delete call in reset-password; no profile confirmation in create-user). Use it only if the new functions block administrators and no other fix is available.

## Status check 2026-11-21: remaining items, reconciled

- **`00017` (SLA recipient dedup, reopen cycle):** applied to production as `20261120203219 sla_recipient_reopen_cycle`. The repo file matches the recorded SHA-256 (`d66b3f31…9471`), and its rollback matches `db8d9dad…9471`. Earlier notes that call it "prepared, not applied" are superseded.
- **Dependency advisories:** `pnpm audit` (root, `--prod`) and `pnpm audit` in `artifacts/itam` both report no known vulnerabilities on `65164a0`. The `xlsx` package is no longer a dependency; reports use `write-excel-file`. Earlier notes that call dependency advisories open are superseded.
- **Local tests:** 29 files, 241 tests passed. `tsc --noEmit` exit 0.
- **`00019` (transactional entity audit) and `00021` (audit retention preview):** not applied. Local proposals. Production application needs a separate approval of the exact SQL and rollback.
- **CSP:** still `Content-Security-Policy-Report-Only` in `vercel.json`. No `report-uri` or `report-to` is configured, so enforcement is not yet safe to turn on.
- **Trusted password gate (server-side enforcement across RLS and RPCs):** not implemented. The design is in `docs/trusted-password-gate-design.md`. It needs a separate approved design and migration.
- **Real signed-in tests (security, accessibility, concurrency):** not run against live accounts. They need user-operated test accounts.
- **Pilot data wipe:** not approved and not executed. See `docs/pilot-data-wipe-plan.md`.

## Update 2026-11-21: structured audit applied; CSP reporting applied and deployed

- **`00019` transactional entity audit:** applied to production as `20261121160903 transactional_entity_audit`. Repo file SHA-256 `c690caed…`, rollback `da4c4e1e…`. Verified by read-only checks and rolled-back probes; details in `docs/structured-audit-review.md` section 7. Live rows after the probes: 0.
- **`00021` audit retention preview:** applied as `20261121160953 audit_retention_preview`. Repo file SHA-256 `fb739c82…`, rollback `6d240eb9…`. Read-only; no purge.
- **`00023` CSP violation reports:** applied as `20261121161512 csp_violation_reports` after the user's approval of the SQL and rollback. Repo file SHA-256 `8f0e6df0…`, rollback `178416f3…`. Contents: table `csp_violation_reports` (RLS; admin-only read; service-role insert only), `purge_csp_violation_reports()` (90-day purge, `SECURITY DEFINER`, not executable by API roles, **not scheduled**). Verified by read-only checks and a rolled-back probe; live reports 0.
- **`csp-report` Edge Function:** deployed as v1 ACTIVE, `verify_jwt` false (id `b543a6f8-82e2-47e5-9100-5a2bccdb1cd8`). Live source matches `supabase/functions/csp-report/index.ts`. **Not verified:** a live POST through the gateway. The sandbox cannot reach `supabase.co`. The synthetic check is in `docs/csp-reporting-review.md` step 2.
- **Vercel:** unchanged. CSP stays `Content-Security-Policy-Report-Only` with no `report-uri`. No browser reports reach the function until a separate approval changes `vercel.json`.
- **Live migration history:** 23 migrations. Latest `20261121161512`. `00018` and `00020` remain under their original live versions and were not reapplied.
- **Correction:** the earlier note that unchanged updates write no audit row was wrong. `updated_at` changes on every ticket UPDATE, so a no-op rewrite writes a row.
- **Edge functions:** `reset-password` v5, `create-user` v4, `change-password` v1, and now `csp-report` v1. All ACTIVE, all `verify_jwt` false.
- **Pilot wipe:** the audit trigger records each deleted row. Decision recorded by the user: keep the wipe's audit rows (`docs/pilot-data-wipe-plan.md` section 4). No deletion authorized.

## Update 2026-11-21: password gate Phase 1 applied

- **`20261101000024` password gate infrastructure:** applied to production as `20261121174713 password_gate_infrastructure` after the user's approval. Repo file SHA-256 `162bd9de…`, rollback `5084ec59…`. Non-enforcing: new service-only tables `password_gate_state` and `password_gate_admitted_sessions`, six service-only functions, no policy or existing-function change, no profile flag written. Live history: 24 migrations. Details and rollback limits: `docs/password-gate-phase1-review.md`.
- **Not changed:** Edge Functions, frontend, Vercel production (`dpl_783iuK…`, `15154ff`), CSP header (`Report-Only`, no `report-uri`).
- **Open:** CSP synthetic POST still needs a 204 result. The phase 2 handlers need their own approval.

## Update 2026-11-23: password gate Phase 3 step 3.0 (grant cleanup) applied

- Supabase `DOST02-ITSMART` (`rkwxdqludtdzbpuftsvi`): migration `20261123181414 password_gate_grant_cleanup`, applied with `create_migration` after the user approved `supabase/proposals/password-gate/grant-cleanup.sql` as written.
- Effect: TRUNCATE, REFERENCES and TRIGGER removed from `anon` and `authenticated` on public tables and views; `anon` removed from `admin_audit_log`; `authenticated` lost INSERT, UPDATE and DELETE on `profiles_with_email`; postgres default privileges for new public tables no longer grant those three privileges to `anon` or `authenticated`. No app behaviour change is expected, because the app does not use these privileges.
- Snapshot: `private.grant_cleanup_snapshot` holds the pre-change ACLs (350 rows). Rollback: `supabase/proposals/password-gate/grant-cleanup-rollback.sql`. It has not been run.
- Not changed: `MAINTAIN` (not approved), service_role grants, RLS, policies, functions, profile column UPDATE grants.
- Frontend and Edge Functions: unchanged in this step.

## Update 2026-11-23: step 3.0 addendum applied (MAINTAIN, profile INSERT)

- Migration `20261123182745 password_gate_grant_cleanup_addendum`, applied on the user's direction (MAINTAIN revoke; column INSERT on the flag columns revoke).
- MAINTAIN removed from `anon` and `authenticated` on all public tables; the postgres default privileges no longer grant it to them.
- `authenticated` lost table-level INSERT on `profiles` and has column INSERT on `id, full_name, role, department, avatar_url, created_at, updated_at, is_active` only. The two flag columns have no INSERT or UPDATE for `authenticated`.
- Snapshot: `private.grant_cleanup_addendum_snapshot` (42 rows). Rollback: `supabase/proposals/password-gate/grant-cleanup-addendum-rollback.sql`, not run.
- Open: `supabase_admin` default privileges for public tables still grant `arwdDxtm` to `anon` and `authenticated` (see the Phase 3 review).

## Update 2026-11-24: step 3.1 schema applied (shadow mode, no enforcement)

- Migration `20261124012612 password_gate_schema_step31`, applied with `create_migration` after the user approved it as written. The migration tool returned no version; it was verified in `supabase_migrations.schema_migrations`.
- Added: `scope` on `password_gate_admitted_sessions` (default `full`, check constraint); `password_gate_admit_restricted_session` (SECURITY DEFINER, `service_role` only); `password_gate_settings` (one row, `shadow`); `password_gate_shadow_log` (empty).
- No policy, helper or app change. Nothing reads the new objects yet, so this step does not change any access decision.
- Rollback: `supabase/proposals/password-gate/schema-step31-rollback.sql`, not run. It refuses while restricted or shadow rows exist.
- Decision 2026-11-24: the user chose to skip the Supabase support request for the `supabase_admin` default privileges. This is an accepted risk, recorded in the Phase 3 review (section 2). No detective check was added.
