# Trusted password gate, Phase 3: enforcement (review package, not applied)

Status (2026-11-23): **document only. Nothing in this package has been applied, deployed, or approved.** No production object was changed. The live checks below were read-only catalog queries on `rkwxdqludtdzbpuftsvi`. Phase 3 is the first step that changes what users can read and write, so it needs the decisions in "Decisions needed" before any SQL is written for production.

Parent documents: `docs/trusted-password-gate-review.md` (phases), `docs/trusted-password-gate-design.md` (requirements), `docs/password-gate-phase1-review.md` (applied infrastructure), `docs/password-gate-phase2-review.md` (deployed handlers).

## 1. Summary

Phase 1 (gate tables and RPCs) and Phase 2 (`change-password`, `reset-password`, `create-user`) are live. Nothing enforces the gate yet. Any signed-in user, including one flagged `must_change_password`, can read and write business data exactly as before.

Enforcement needs three things that do not exist yet:

1. **A login path that admits the session.** The frontend signs in with `supabase.auth.signInWithPassword` directly (`artifacts/itam/src/lib/auth-context.tsx`). Nothing calls `password_gate_admit_session`. If enforcement were switched on today, every user would be locked out.
2. **Gate-aware helpers.** `get_my_role()` and `is_active_user()` are the basis for almost every business policy. Neither checks the gate.
3. **Explicit coverage for policies that do not use the helpers.** The `notifications` policies use `auth.uid()` directly.

The recommended order is: a grant cleanup first, then the admission login path in shadow mode (record what would be denied, enforce nothing), then enforcement behind a switch that can be flipped back without a deploy.

## 2. Live state verified on 2026-11-23 (read-only)

| Check | Result | Consequence |
| --- | --- | --- |
| `profiles` column grants for `authenticated` | UPDATE only on `department`, `full_name`, `is_active`, `role`. **No** UPDATE on `must_change_password` or `password_changed_at`. | Migration `20261101000022` is live. A signed-in user cannot clear their own flag through the Data API. **This corrects** the 2026-11-23 note in `trusted-password-gate-design.md`, which said `authenticated` held those UPDATE grants. That note is superseded. Re-verify before each change. |
| `profiles` row policy `profiles_update_self_or_admin` | Allows an active user to update their own row, subject to the column grants and `guard_profile_update`. | Acceptable for now. Re-check after enforcement. |
| `get_my_role()` | SECURITY DEFINER. Returns the role when `is_active = true`. No gate check. `anon` has EXECUTE. | Every helper-based policy stays open to a flagged user. |
| `is_active_user()` | SECURITY DEFINER. Returns `is_active`. No gate check. `anon` has EXECUTE. | Same as above. Returns false for `anon`, so the `anon` grant is harmless in itself. |
| Table grants, `authenticated` on business tables | `INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` on `tickets`, `assets`, `asset_history`, `asset_maintenance_log`, `categories`, `ticket_comments`, `notifications`, `profiles`, `admin_audit_log`. | RLS does **not** apply to TRUNCATE, REFERENCES or TRIGGER. The Data API does not expose TRUNCATE to PostgREST callers. The grant is still wider than the design. Remove it (step 3.0). |
| Table grants, `anon` | `admin_audit_log` has INSERT, SELECT, UPDATE, DELETE and TRUNCATE for `anon`. `has_table_privilege('anon', 'admin_audit_log', 'TRUNCATE')` is true. | Policies deny `anon` today because `get_my_role()` is null for `anon`. The grants should still be removed (step 3.0). |
| RLS enabled | All business tables, `csp_violation_reports`, `entity_change_audit`, and the two gate tables. Gate tables have no grants to `anon` or `authenticated`. | Good. |
| `profiles_with_email` | View with `security_invoker = true`. Joins `private.profile_contact_details`. Has write grants for `authenticated`. | Writes run as the invoker, so profile RLS and column grants apply. Confirm in the role test (section 7). |
| Realtime publication `supabase_realtime` | `public.notifications`, `public.profiles`. | Postgres-changes subscriptions must respect RLS. Confirm that a gated session receives nothing from business tables (section 7). |
| Storage | `storage.objects` and `storage.buckets` exist. Policies were **not** inventoried here. | Open item. Review before enforcement. |
| Exposed SECURITY DEFINER functions executable by `authenticated` | `record_asset_maintenance`, `create_asset_with_history`, `correct_asset_maintenance`, `return_asset_to_service`, `update_asset_pm_schedule`, and the helpers `get_my_role`, `is_active_user`. | All five RPC bodies reference `get_my_role`. Gating the helper covers them only if each body is confirmed (section 3.3). |
| `update_ticket_with_activity` | SECURITY INVOKER, executable by `authenticated`. Uses `is_active_user()` and `auth.uid()`. | Covered by a helper change, because invoker writes go through RLS. |
| Service-only definer functions | `auto_close_resolved_tickets`, `cleanup_old_notifications`, `generate_pm_notifications`, `notify_sla_at_risk`, `notify_sla_breached`, `purge_csp_violation_reports`, and all `password_gate_*` functions. | Not callable by users. They act for the system, so session gating does not apply to them. |
| `auth.sessions` | Present. The gate design requires `id`, `user_id`, `created_at`, `not_after` (verified earlier). | The admission check depends on it. |

## 3. What enforcement must cover

### 3.1 Policies that use the helpers (covered by a helper change)

- `assets`, `categories`, `asset_history`, `asset_maintenance_log`: select, insert, update and delete all use `is_active_user()` or `get_my_role()`.
- `tickets`, `ticket_comments`: select uses `is_active_user()`. Insert, update and delete use `get_my_role()`, `is_active_user()` or `auth.uid()`.
- `admin_audit_log`, `entity_change_audit`, `csp_violation_reports`: read or write uses `get_my_role()`.
- `profiles`: select is `is_active_user() OR id = auth.uid()`. Update is `is_active_user() AND (self OR administrator)`.

### 3.2 Policies that do **not** use the helpers (need an explicit gate condition)

- `notifications`: `notifications_select_own`, `notifications_update_own`, `notifications_delete_own` use `auth.uid()` only. `notifications_insert_own` uses `is_active_user()`.
- `profiles_insert_self`: `auth.uid()` and `role = 'general_user'`. It needs review, because it does not check that the account is active.

Notifications contain ticket titles and asset events. Treat them as business data (see decision D1).

### 3.3 Definer RPCs (confirm each body)

Each body must be checked for three things: whether it calls `get_my_role()`, whether it checks `auth.uid()` in a way that bypasses the helpers, and whether it writes to tables directly. The five RPCs above all reference `get_my_role` in their source, so the helper change covers them only if that reference gates the operation. Each body needs a line-by-line review before enforcement. A function that checks the role but not the gate must also check the gate itself, through an explicit call.

### 3.4 Edge Functions

- `change-password`, `reset-password`, `create-user`: service-role. They do not depend on RLS. They enforce the gate themselves (Phase 2). They must keep working for a restricted session, because `change-password` is the only path a flagged user needs.
- `csp-report`: unauthenticated by design, writes only through the service role. No change.

### 3.5 Service and cron paths

`service_role` bypasses RLS. Cron-driven functions (SLA notifications, PM notifications, auto-close, CSP purge) run as the database owner or service role. They must not depend on `get_my_role()` or `is_active_user()`. Confirm this in the test matrix, because a helper that returns null for the service would break them.

## 4. Proposed design

### 4.1 Session admission (the login path)

- Every sign-in goes through a service-side login broker. The broker calls GoTrue `grant_type=password`, reads the returned user and `session_id`, and calls `password_gate_admit_session(user, session, generation)` only if the generation is still current. The browser never supplies the session ID.
- The broker design in `supabase/proposals/password-gate/login-broker.ts` is an isolated prototype. It needs production hardening (rate limits, uniform error responses, no account-state timing leaks) before use.
- Current sessions have no admitted row. At cutover, every user signs in again through the broker. Pilot data is planned for wipe, and the forced sign-in is the cost of a clean cutover (decision D3).
- The admitted-session check uses `auth.jwt() ->> 'session_id'`. The access token must carry that claim. This is a documented GoTrue claim, but the presence of the claim in this project's tokens was not verified. Verify it on a dedicated test account before writing any policy.
- `password_gate_admit_session` (Phase 1) only admits sessions when the gate is `cleared`. A **restricted** admission, for a flagged account, is also needed so a flagged user can reach the change page. This requires a `scope` column (`full` or `password_change_only`) on `password_gate_admitted_sessions` and a new admit function. That is a Phase 3 migration.

### 4.2 Gate-aware helpers

Replace `get_my_role()` and `is_active_user()` (same signatures, same grants except as below) so that each returns null or false unless all of these hold:

1. the caller's JWT `session_id` has an admitted row for `auth.uid()`;
2. that row's `scope` is `full`;
3. the account's gate row is `cleared` and its `generation` equals the admitted row's generation;
4. the account is active.

Because every existing helper-based policy calls one of these two functions, a flagged or unadmitted caller is denied everywhere those policies apply, without editing each policy. The helpers are SECURITY DEFINER and must keep a fixed `search_path`.

Helpers also run for `anon`. With no `auth.uid()`, they return null or false. Keep it that way.

### 4.3 Explicit conditions where helpers are not used

- `notifications` select, update and delete: add the same full-scope admitted check as the helpers (or a new `password_gate_full_session()` boolean).
- `profiles` self-read in restricted scope: a restricted session may read its own profile row only, so the app can see `must_change_password`. This is the one carve-out. It must not expose other rows, and it must not allow a restricted session to write.
- `profiles` update: restricted sessions get no update through RLS. The flag remains writable only by the service.

### 4.4 Restricted scope

A flagged account (`required`, `resetting`, or `changing`) can hold only a restricted session. It can:

- call `change-password` (Edge, service role);
- read its own profile row;
- nothing else.

After a successful change, GoTrue global sign-out revokes every session. The user signs in again through the broker and receives a `full` admission under the `cleared` generation.

### 4.5 Admin reset and old sessions

An admin reset begins a new operation, which changes the generation (`password_gate_begin_reset`). Every admitted row keyed to the old generation then fails the helper check. Access therefore ends at the database even if GoTrue still honours an old JWT for other Auth endpoints. Auth-level revocation (`sessionRevocation: 'unverified'` in `reset-password`) remains a separate, unverified item.

### 4.6 Retained administrator

No policy exemption. The retained administrator signs in through the broker like everyone else. If that account is ever flagged, the recovery path is the Phase 4 procedure, run by an administrator who is not flagged. This matches the design rule "do not lock it out" without a standing bypass. Decision D4 confirms this.

### 4.7 Realtime

`notifications` and `profiles` are published. Confirm that postgres-changes delivery to a restricted or unadmitted session is filtered by RLS, and that no business-table events reach a gated session. If that cannot be confirmed, remove the tables from the publication for the affected scope and move the notification to polling.

### 4.8 Grant cleanup (step 3.0, can go first)

- Revoke `TRUNCATE, REFERENCES, TRIGGER` from `anon` and `authenticated` on every table in `public`.
- Revoke every privilege on `admin_audit_log` from `anon`.
- Keep `service_role` grants unchanged.
- Snapshot the current grants (`information_schema.role_table_grants`) immediately before applying, so that the rollback restores them exactly.

This step does not change behaviour for the app, because the app does not use TRUNCATE, REFERENCES or TRIGGER through the Data API. Verify that no migration or trigger relies on those grants before applying.

**Step 3.0 package (prepared and tested 2026-11-23; applied 2026-11-23 as migration `20261123181414`, approved as written):**

- `supabase/proposals/password-gate/grant-cleanup.sql`: snapshot of relation, column and default ACLs into `private.grant_cleanup_snapshot` before any change; then the revokes; then a check that fails the script if anything remains.
- `supabase/proposals/password-gate/grant-cleanup-rollback.sql`: restores every snapshotted grant and default privilege, then drops the snapshot table. It refuses to run without a snapshot.
- `artifacts/itam/src/lib/grant-cleanup.local.test.ts`: applies every repository migration in PGlite, recreates the live drift (below), applies the cleanup, and checks privileges, app writes, TRUNCATE denial, anon denial on `admin_audit_log`, future tables, the exact rollback, re-apply, and the refusal without a snapshot. 11 tests pass. This is a local PostgreSQL, not live Supabase.
- The package is in `supabase/proposals/`, not `supabase/migrations/`, so no migration sweep can apply it by accident.

**Why the test recreates the drift.** The repository migrations grant only SELECT, INSERT, UPDATE and DELETE (`20261028000002`). Live tables show TRUNCATE, REFERENCES, TRIGGER and MAINTAIN for `anon` or `authenticated`, which is what Supabase default privileges produce. PGlite has no such defaults, so the test copies the live catalog shape into the database before testing the cleanup.

**Extra changes beyond section 4.8, for your approval:**

1. `profiles_with_email`: revoke INSERT, UPDATE and DELETE from `authenticated`. The frontend only reads this view, and the view is not auto-updatable anyway.
2. Default privileges: `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` in `public`, so new tables do not regain TRUNCATE, REFERENCES or TRIGGER for `anon` and `authenticated`. Without this, the cleanup does not last.
3. Column-level REFERENCES: a table-level REVOKE removes it too (PGlite-checked). The apply script also fails if any remains.

**Not in this package, and open:**

- `MAINTAIN` (PostgreSQL 17): **resolved 2026-11-23.** It was granted to `anon` and `authenticated` on the business tables. The addendum (migration `20261123182745`, user decision) revoked it, and removed it from the postgres default privileges. It gates maintenance commands such as VACUUM, ANALYZE, CLUSTER and REINDEX, not row access (the local test shows REINDEX fails without it). LOCK TABLE is not gated by it.
- **Accepted risk (2026-11-24): `supabase_admin` default privileges.** The default privileges for public tables created by `supabase_admin` still grant `anon` and `authenticated` `arwdDxtm`, including TRUNCATE, REFERENCES, TRIGGER and MAINTAIN. Our migrations run as `postgres`, so the addendum does not cover this. The catalog shows no public table owned by `supabase_admin`. The user chose to skip the Supabase support request and accepted this risk. It does not block Phase 3. No detective check was added. Revisit if any table is created by `supabase_admin`, or before a pilot launch.
- Column-level ACLs on other public tables are not verified live. The Supabase API returned 502 on the two attempts to query `pg_attribute.attacl`. The snapshot captures them anyway, so the rollback is complete whatever the live check shows.
- `authenticated` column INSERT on `must_change_password` and `password_changed_at`: **resolved 2026-11-23** by the addendum. The table-level INSERT was replaced with an explicit column list (`id, full_name, role, department, avatar_url, created_at, updated_at, is_active`). The register upsert columns are unaffected.
- `csp_violation_reports` grants SELECT to `authenticated`. RLS decides who can read it. Not reviewed here.
- Storage policies are still uninventoried (D8).

### 4.9 Shadow mode and enforcement switch

- A service-only setting (a row in a new `password_gate_settings` table, or an equivalent) selects `shadow` or `enforce`.
- In `shadow`, the helpers compute the admission decision and write one row per denied access into a service-only log table (no PII beyond the user ID, the object name and the time). They return the **allowed** result, so the app behaves as now.
- Shadow runs long enough to see every expected sign-in path (frontend, Edge handlers, cron, the retained administrator's normal use) without unexpected denials.
- Switching to `enforce` takes effect without a deploy. Switching back to `shadow` is the first rollback step.

## 5. Ordering

1. **3.0 Grant cleanup.** Snapshot, apply, test, approve.
2. **3.1 Schema.** Add `scope` to admitted sessions, add the settings table and the shadow log, and add the restricted admit function. No policy change.
3. **3.2 Broker login in the frontend.** Deploy the frontend that signs in through the broker. Works with the current policies (nothing is enforced yet).
4. **3.3 Shadow.** Helpers compute and log decisions. Observe for an agreed period.
5. **3.4 Enforce.** Flip the switch with the helper change already in place. Re-run the role matrix.
6. **Phase 4.** Recovery procedure and reconciliation must exist before step 5 is approved, or the stranded-account risk is accepted again in writing.

Each step needs its own SQL review, rollback, test and approval. None is authorized by this document.

## 6. Rollback

- **Fast:** set the switch to `shadow`. Admitted sessions remain and cause no harm.
- **Structural:** a reviewed SQL script that restores the exact pre-change definitions of `get_my_role`, `is_active_user`, every changed policy and the grants. The script is generated from a catalog snapshot taken immediately before apply (`pg_get_functiondef`, `pg_policies`, grant listing). It is tested in a disposable PostgreSQL before any production run.
- **Frontend:** the previous frontend deployment that signs in directly still works while enforcement is off. Keep it as the rollback target until enforcement has run for an agreed period.
- The rollback does not delete admitted-session rows or gate state. Those hold no business data.

## 7. Test matrix (to run after approval, on dedicated accounts only)

Accounts: the three dedicated test accounts (administrator, support, general user), and one flagged test account created through `create-user`. The retained administrator is **not** tested unless you approve it separately.

Local (disposable PostgreSQL and PGlite, before any production run):

- Every policy and helper: allowed and denied for each role, status and session state below.
- Grant assertions: no TRUNCATE, REFERENCES or TRIGGER for `anon` or `authenticated`; no `anon` privileges on `admin_audit_log`.
- Service and cron functions run with no session.
- Rollback script restores the captured state exactly (diff the catalog before and after).

Signed-in, against the deployed app (user-operated, as in `docs/user-operated-signed-in-test-plan.md`):

| Subject | Action | Expected |
| --- | --- | --- |
| Full-scope admin | read tickets, assets, notifications; update an asset; run a maintenance RPC | allowed |
| Full-scope support | read tickets; change status; create an asset | allowed as role rules |
| Full-scope general user | read own tickets; read another user's ticket | own allowed; other denied |
| Flagged test account (`required`) | read tickets, assets, notifications; call a maintenance RPC; direct PostgREST update of own profile | all denied except own-profile read and `change-password` |
| Flagged test account, after change | sign in again through the broker | full access under the new generation |
| Old session after a change or admin reset | any business read or write | denied |
| Unadmitted session (signed in without the broker) | any business read or write | denied |
| Realtime subscriber, restricted session | subscribe to `notifications` and `profiles` | no business events |
| Cron-driven functions | run as scheduled | unchanged |
| `anon` | read or write any table; call any helper | denied |

Each signed-in test that writes creates or changes data, so it needs approval and marked synthetic records, as before.

## 8. Risks

- **Stranded users.** Enforcement can lock out a legitimate user whose admission row is missing or whose gate is stuck. Mitigation: shadow mode, the switch, and the Phase 4 procedure. Without Phase 4, an administrator has no in-app way to unlock a stuck account.
- **Retained administrator.** No bypass means no way in if the account is stuck. This is the reason for D4 and the Phase 4 dependency.
- **Claim presence.** If the `session_id` claim is missing from some tokens, admission fails closed. Verify on a test account first.
- **Performance.** The helpers run per row. Keep the admitted-session lookup on the primary key and cache it per statement where possible. Measure in shadow mode.
- **Storage and other surfaces.** Storage policies, any future Edge Function that reads business data, and direct Auth endpoints are not covered by this design. They need their own review before enforcement is called complete.
- **Concurrency.** A transaction that started before a reset can still finish with old data. This was analysed in the design but not tested under real GoTrue timing.

## 9. What this document does not establish

- It does not show that enforcement works. Nothing here has been run against the live database, Auth, Realtime or the frontend.
- It does not verify the `session_id` claim, the Realtime filtering behaviour, storage policies, or any function body beyond the metadata listed above.
- It does not change the Phase 2 status. Phase 2 remains deployed, with the stranded-account risk accepted in writing.

## 10. Decisions needed

- **D1. Scope.** Gate notifications as business data? Recommended: yes.
- **D2. Login path.** Every sign-in through the broker, with no fallback to direct sign-in? Recommended: yes. The timestamp-only alternative is rejected by the design because of the late-session race.
- **D3. Existing sessions.** Accept a forced sign-in for all users at cutover? Recommended: yes. Pilot data is planned for wipe.
- **D4. Retained administrator.** No standing bypass; recovery only through the Phase 4 procedure? Recommended: yes. Do you want the retained account included in signed-in tests? Recommended: no, unless you approve a specific test.
- **D5. Shadow period.** How long, and what counts as "clean"? Suggested: at least one full working week covering all roles, with zero unexpected denials.
- **D6. Switch location.** A service-only settings row (recommended, flippable without a deploy) or a function constant (requires a migration to flip)?
- **D7. Grant cleanup first.** Approve step 3.0 on its own, ahead of the rest? Recommended: yes, because it is low-risk and does not change app behaviour.
- **D8. Storage review.** Approve a read-only inventory of storage policies before step 3.3?

## 11. Next step

Decisions D1 to D8 were accepted on 2026-11-23. Step 3.0 was approved as written and applied on 2026-11-23 as migration `20261123181414`. Post-apply checks: no TRUNCATE, REFERENCES or TRIGGER for `anon` or `authenticated` on public relations; no column-level REFERENCES; `authenticated` keeps SELECT and the tickets write grants, and loses TRUNCATE; `service_role` keeps TRUNCATE; the profile column UPDATE grants are unchanged; the snapshot table holds 350 rows. The addendum was applied as migration `20261123182745` on the user's direction: MAINTAIN revoked from `anon` and `authenticated`, and the flag-column INSERT removed (42 snapshot rows).

Step 3.1 (schema only) was **approved as written by the user on 2026-11-24 and applied** as migration `20261124012612`. Live checks: `scope` defaults to `full` with its check constraint; `password_gate_settings` holds one row, `shadow`; both new tables have RLS on and no policies; the restricted admit function is executable by `service_role` only; `authenticated` and `anon` have no access to the two new tables. `service_role` also has no direct privilege on the two new tables (the file revokes it), so step 3.3 must read the mode and write the shadow log through a SECURITY DEFINER function. Rollback (`schema-step31-rollback.sql`) not run. Package: `supabase/proposals/password-gate/schema-step31.sql` and `schema-step31-rollback.sql`. It adds `scope` to admitted sessions (default `full`), a restricted admit function (service role only; admits only `required` or `changing` accounts, with the current generation, a session created after the state was set, and an active account; refuses `resetting` and `cleared`; plain INSERT so it cannot overwrite a row), `password_gate_settings` (one row, `shadow`), and `password_gate_shadow_log`. It adds no policy or helper change. The local test (`artifacts/itam/src/lib/password-gate-phase3-step31.local.test.ts`, 15 tests with the addendum) covers the restricted-admit refusals, full-scope regression, no upgrade of a restricted row, and a rollback that refuses while restricted or shadow rows exist.

Accepted risk, not blocking: the `supabase_admin` default privileges (see section 2). The next packages are step 3.4 (helpers and policies), step 3.2 (broker login) and step 3.3 (enforcement, after the shadow period). Each needs its own SQL, rollback, local test and approval. Nothing is applied to production without a separate approval.

## 12. Shadow skipped; steps 3.2a and 3.3 applied; 3.4 not applied (2026-11-24)

**Decision.** On 2026-11-24 the user chose to skip the shadow period (D5). Each step still goes to production only on its own approval. Enforcement also still needs Phase 4 recovery, or a written acceptance of the stranded-account risk (section 5, step 6).

**Read-only findings that change the plan:**

- 14 of the 15 profiles have **no** `password_gate_state` row. Only one row exists (`cleared`). None of the 14 has `must_change_password` set. Phase 1 admit requires a `cleared` row, so without a backfill, enforcement would lock these accounts out, and the broker could not admit them. This is step 3.2a.
- The guards (`guard_ticket_update`, `guard_ticket_insert`, `guard_profile_update`, `validate_asset_pm_dates`), `audit_retention_preview`, `correct_asset_maintenance`, `create_asset_with_history`, `record_asset_maintenance`, `return_asset_to_service` and `update_asset_pm_schedule` all deny or skip on a NULL role, or only fire when `auth.uid()` is set. None lets a NULL role through. Cron and service paths run with `auth.uid()` NULL and are not affected (PGlite-tested).
- Storage (D8, read-only): 0 buckets, 0 objects, 0 storage policies. The inventory is clean for now. It must be repeated before step 3.4.
- `anon` holds no table privileges on any public table.
- `authenticated` can read or write 11 RLS tables, plus `profiles` as a special case.

**Step 3.2a applied** as migration `20261124020959` (approved 2026-11-24). Live after apply: 15 of 15 profiles have a gate row (14 new, all `cleared`); mode unchanged. Data step: `supabase/proposals/password-gate/gate-backfill-cleared.sql`, rollback `gate-backfill-cleared-rollback.sql` (not run). It inserts a `cleared` gate row for each profile that has none. Each row gets a new generation. The rollback deletes only the rows the backfill created, and only if still `cleared`.

**Step 3.3 applied** as migration `20261124021030` (approved 2026-11-24), settings left in `shadow`. Live checks: 11 restrictive policies plus the `profiles` policy; `get_my_role` and `is_active_user` reference the gate; `password_gate_scope_ok()` returns true with no session (shadow); `anon` cannot execute it; `authenticated` can; shadow log and admitted-session tables are empty. Source: `supabase/proposals/password-gate/enforcement-step33.sql`, rollback `enforcement-step33-rollback.sql` (not run). Details:

- Adds `password_gate_enforcement_mode()`, `password_gate_full_session()` and `password_gate_scope_ok()`. The mode comes from the settings row. A missing row counts as `enforce`.
- Replaces `get_my_role()` and `is_active_user()`, keeping their signatures and grants. Each returns the old value in `shadow` and the gated value in `enforce`.
- Adds a RESTRICTIVE policy `password_gate_scope` (for all commands, to `authenticated`) on 11 tables: `admin_audit_log`, `asset_history`, `asset_maintenance_log`, `assets`, `categories`, `csp_violation_reports`, `entity_change_audit`, `notifications`, `ticket_comments`, `tickets`, and `profiles`. `profiles` has one carve-out: a caller can always read and write its own row. A restricted session therefore sees its own `must_change_password`, but the update policy still needs an active full-scope account, so it cannot write.
- Leaves the settings at `shadow`. Applying step 3.3 changes nothing for users.
- Snapshot-based rollback. It restores the two helpers exactly, drops the policies and helpers, and refuses to run without the snapshot.

**Step 3.4 (enforce), not applied, needs its own approval.** The flip itself is: `UPDATE public.password_gate_settings SET mode = 'enforce', updated_at = clock_timestamp() WHERE id = 1;`. Prerequisites: step 3.2 deployed (the broker is the only sign-in path); step 3.2a applied; every user has signed in through the broker (D3, so existing sessions have no admitted row and will be denied); the Realtime check (4.7) done on dedicated accounts; the signed-in role matrix (section 7) run; and Phase 4 recovery in place, or the stranded-account risk accepted in writing.

**Local tests.** `artifacts/itam/src/lib/password-gate-phase3-step33.local.test.ts`: 19 tests (PGlite). Covered: shadow is inert; enforce denies an admin without a session; the carve-out; an unknown session claim; full admission for admin, support and general; a restricted session sees no business rows and cannot write its profile or create a ticket; an old session after a reset is denied and a new generation admits; an inactive account is denied and reactivation restores it; an account without a gate row cannot be admitted; service, cron and guard paths run with no session; anon has no path; the backfill (create, roll back only its own rows, re-apply); the fast switch back to shadow; the structural rollback restores the helper definitions exactly; and the rollback refuses without a snapshot. The full itam suite passes at 34 files and 346 tests, and `tsc --noEmit` exits 0.

**Not done, and open:**

- Step 3.2 (the broker in the frontend, and deploying the Edge login broker) is not drafted. It is the next blocker for 3.4. `supabase/proposals/password-gate/login-broker.ts` is still only a prototype.
- Self-signup and the register path: `profiles_insert_self` is unchanged, and I have not checked whether any path still creates an account without a gate row. Check before 3.4.
- Realtime delivery (4.7) is not tested. It needs the dedicated accounts, at 3.4.
- Local tests use PGlite, not GoTrue or PostgREST. The `session_id` claim in live tokens is still unverified (section 4.1), so verify it on a dedicated account before 3.4.
- The test environment's `pnpm-lock.yaml` does not match the workspace `overrides` (the frozen install fails). The lockfile was not changed in the repository. Installing without the frozen flag gave working tests.

## 13. Step 3.2 (broker login) deployed to Supabase; frontend on a preview, not promoted (2026-11-24)

**What is live.**

- Edge Function `login-broker` (slug `login-broker`, id `02114116-f161-4f74-87d5-b0639be17c81`, project `rkwxdqludtdzbpuftsvi`), `verify_jwt=false`, status ACTIVE, version 1. The read-back body matches `supabase/functions/login-broker/index.ts` at commit `68000a0`.
- Frontend commit `68000a0`, pushed. Preview `dpl_EAYXzuGHpzynKb7FHQA7Uv47drrn` is READY at `itsmart-dost02-hi7lh42o1-theneilcruz-gmailcoms-projects.vercel.app`. It is not promoted; production `itsmart-dost02.vercel.app` still runs the previous build and still signs in directly.
- Live endpoint behaviour from the sandbox could not be checked, because the sandbox cannot reach Supabase.

**What changed in the code.**

- `login-broker`: an inactive profile, checked after a verified password, now returns `403 account_unavailable` (it returned `401 login_failed` in the draft). Every other refusal is unchanged.
- `auth-context.tsx` `login()`: calls the broker and installs the session with `setSession`. A `password_change_required` answer routes to `/change-password` and sets the mandatory-change flag. The existing inactive and must-change checks still run.
- `lib/login-broker.ts`: maps broker codes to messages. `invalid_input` asks for both fields, `login_failed` gives the invalid-credentials text, `account_unavailable` gives "Account unavailable", and everything else gives the temporary-unavailable text. `login.tsx` maps "account unavailable" to a contact-the-administrator message.
- Tests: `login-broker-edge.test.ts` (16, the real function source with mocked GoTrue and REST), `login-broker.test.ts` (6, client). Full itam suite 36 files / 368 tests; `tsc --noEmit` exit 0.

**Still open before step 3.2 is complete.**

1. **Live `session_id` claim (section 4.1).** The broker refuses any token without a UUID `session_id`. If the live token lacks the claim, every sign-in fails closed with `login_failed`. Check this on the first dedicated-account sign-in.
2. **Rate limiting and lockout** are not in the function. GoTrue applies them only in part. Recorded as open in the function header.
3. **Signed-in test on live** for these accounts, on the preview: a `cleared` full session; a `required` or `changing` restricted session that reaches `/change-password` and is blocked from other routes; a `resetting` account refused with 403. The user must run these. They use dedicated accounts only, and no test runs on the retained administrator (D4).
4. **Promotion of the preview to production** is a separate approval. Until then the broker is deployed but unused.
5. **The restricted session must be able to complete the password change.** `change-password` (`9f58af79`) was not changed and was not re-tested against a restricted session. Test it in step 3.

**Step 3.4 (enforce)** stays blocked until section 5's eight prerequisites hold and the user approves that apply separately. Step 3.2 completion is one of them.

**Correction (2026-11-24, found in the first live test).** The sign-in error on the preview was a 503 `login_unavailable` for both test accounts. The cause was in the draft: `login-broker` read `password_gate_state` over REST. Phase 1 (`20261101000024`) revoked every privilege on that table from `service_role`, so PostgREST refused the read and the broker failed closed. The accounts themselves are fine (both active, confirmed, `cleared`). Fix drafted, not applied: `supabase/proposals/password-gate/broker-state-read.sql` (a read-only, service-only function `password_gate_broker_state(uuid)`), its rollback, and the broker change to call it. Tests: `password-gate-broker-state.local.test.ts` (6) and the broker edge test (now 19). Apply order once approved: the database function first, then redeploy `login-broker`. Redeploying the broker before the database function would return 503 again.
