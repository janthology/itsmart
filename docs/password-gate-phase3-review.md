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

**Applied (2026-11-24, approved by the user).** Database: migration `20261124032732` (`password_gate_broker_state_read`). Verified: `service_role` can execute the function; `anon` and `authenticated` cannot; it is SECURITY DEFINER; the state table is unchanged (15 rows); `service_role` still has no table privilege. Edge Function `login-broker` redeployed as version 2 (ACTIVE, `verify_jwt=false`), body read back and matches the source. Preview `dpl_EAYXzuGHpzynKb7FHQA7Uv47drrn` needs no rebuild (the frontend did not change). Sign-in on the preview still needs a live test by the user.

## 14. Readiness check for 3.2 and 3.4 (read-only, this run)

**Nothing was applied or flipped in this run.** The mode is still `shadow`. No production write was made. The checks below were read-only catalog and table queries on `rkwxdqludtdzbpuftsvi`, plus local test runs. The sandbox cannot reach Supabase or the preview hosts (HTTP returned `000`), so no live sign-in was attempted here.

**Live state read back:**

- `password_gate_settings`: `mode = shadow`, last updated 2026-11-24 01:26:12 UTC.
- `password_gate_state`: 15 rows, all `cleared`. 15 profiles and 15 `auth.users`. No profile without a gate row, and no auth user without a profile.
- `password_gate_admitted_sessions`: 0 rows. `auth.sessions`: 0 rows. Nobody is signed in right now. The `usertest` session that was admitted earlier has ended, and its admitted row went with it through the cascade.
- Storage (D8, repeated): 0 buckets, 0 objects, 0 storage policies.
- Realtime publication `supabase_realtime`: `public.notifications` and `public.profiles`. RLS is on for both. Delivery under RLS is not tested.
- `password_gate_recovery_log`: does not exist. Phase 4 is not applied.
- `auth.users.last_sign_in_at`: `admintest`, `supporttest`, `theneilcruz` and `usertest` signed in between 03:48 and 03:51 UTC on 2026-11-24, which is the broker test window. The other 11 accounts last signed in before 2026-11-21.

**Status of the 3.2 checks:**

| Check | Status |
| --- | --- |
| Live `session_id` claim (section 4.1) | **Verified.** The broker refuses any token without a UUID `session_id`, and it admitted the dedicated account `usertest` at 03:51:14. The admitted row's `session_id` matches the `auth.sessions` row. |
| Restricted session completes the password change (13, item 5) | **Verified by the user's report** (`usertest` signs in and completes the change). The database shows `usertest` `cleared` with `must_change_password = false`. |
| Wrong password: refused, no session, no tokens | **Local only** (`login-broker-edge.test.ts`: `login_failed` without a session). **Live check still open** (browser test by the user). |
| Inactive account: `account_unavailable`, no tokens | **Local only** (test: refused and logged out). **Live check still open.** Candidates: `jonakampani@gmail.com` and `shanewesleymangoba31@gmail.com` (both inactive; the second is an administrator). |
| Restricted route: a `required` or `changing` session reaches only `/change-password` | **Live check still open.** No dedicated account is currently flagged. Flagging one is a production write and needs approval. |
| `resetting` account refused with 403 | **Local only** (test). **Live check still open.** |
| Rate limiting and lockout | **Open.** Not in the function. GoTrue applies some limits only. |

**Status of the 3.4 prerequisites (section 5):**

| Prerequisite | Status |
| --- | --- |
| Step 3.2 deployed (broker is the only sign-in path) | Met for the code: production runs the broker build, and `login-broker` v2 is live. The open checks above remain. |
| Step 3.2a applied | Met. 15 of 15 gate rows. |
| Every user has signed in through the broker (D3) | **Not met literally.** Four accounts have. Eleven have not signed in since before 2026-11-21. Because nothing is signed in right now, no unadmitted session exists to deny. Enforcement would only affect future sign-ins, and those go through the broker. Your decision whether this counts as met. |
| Realtime check (4.7) on dedicated accounts | **Not done.** Needs a browser subscription test. |
| Signed-in role matrix (section 7) | **Not done.** Needs signed-in dedicated accounts and approval for writes. |
| Phase 4 recovery in place, or stranded-account risk accepted in writing | **Not met.** Drafted and tested (`c77665b`), not applied. Needs approval to apply, or written acceptance. |
| `session_id` claim verified on a dedicated account | **Met** (see above). |
| Self-signup and register path | Signup is disabled at GoTrue (`disable_signup = true`). `register()` in `auth-context.tsx` still calls `signUp` directly, which would make a session with no admitted row. No component calls it, and `/register` redirects to `/login`. It is dead code today. Remove it or route it through the broker before signup is re-enabled. |
| Storage inventory (D8) | **Met** for this run (empty). |

**Local tests run in this check:** `login-broker-edge.test.ts` and `login-broker.test.ts`, 25 tests, all passing. `password-gate-recovery.local.test.ts`, 12 tests, passing.

**Decision.** Step 3.4 is **not ready**. The enforce flip (`UPDATE public.password_gate_settings SET mode = 'enforce' ... WHERE id = 1`) stays blocked until the user runs the live browser checks above and decides on the D3 item and on Phase 4. The flip and the Phase 4 apply each need their own approval.

## 15. User decisions and Phase 4 applied (2026-11-24)

**Standing rule from the user.** Self-registration is not allowed. Only an administrator creates user accounts, through `create-user`. Verified: `create-user` requires an active administrator (line 109 of `supabase/functions/create-user/index.ts`), and GoTrue has `disable_signup = true` (read live, this run).

**User decisions.**

1. **Live checks for 3.2 reported passed.** The user reports the five live checks passed. The four live checks from section 14 (wrong password, inactive account, restricted route, `resetting` refused with 403) are covered by this report. The fifth item in section 14 was rate limiting, which is not a live check. It stays open until the user confirms otherwise.
2. **Test accounts.** The checks used the three dedicated test accounts (`admintest`, `supporttest`, `usertest`). The retained administrator was not used.
3. **D3 accepted.** The 11 accounts that have not signed in through the broker are accepted. Nobody has an active session right now, so nothing unadmitted would be denied at enforcement.
4. **Phase 4 applied to production.** See below.

**Phase 4 apply (production, 2026-11-24).**

- Migration `20261124041528_password_gate_recovery` (created by the migration tool, then verified). Source: `supabase/migrations/20261124041528_password_gate_recovery.sql`. Rollback: `supabase/rollbacks/20261124041528_password_gate_recovery.sql`. The rollback refuses while the recovery log has rows.
- Verified after apply: `password_gate_recovery_log` exists with RLS on and 0 rows. `password_gate_recover_account` is `SECURITY DEFINER` and executable by `service_role` only (`anon` and `authenticated` both false). `service_role` has no SELECT on the log.
- Unchanged: 15 of 15 gate rows `cleared`; mode `shadow`; no profile has `must_change_password` set.
- Local tests: the full itam suite passed (38 files, 389 tests) before the rename, and the recovery and infrastructure tests (39) passed after it.

**Step 3.4 status (not flipped).** The enforce flip is still not applied, and it needs its own explicit approval. Blockers still open:

- **Realtime check (4.7).** Not done. It needs a browser subscription test on the dedicated accounts.
- **Signed-in role matrix (section 7).** Not done. It needs the signed-in dedicated accounts, and any write needs approval.
- **Explicit approval for the flip.** Not given. The user's approval list covered Phase 4 and D3, not the flip.
- **Rate limiting and lockout (3.2, item 5).** Open. Not a live check. Needs a decision.
- **`register()` in `artifacts/itam/src/lib/auth-context.tsx`.** Still calls `supabase.auth.signUp`. No component calls it, and `/register` redirects to `/login`. Signup is disabled at GoTrue, so this cannot create an account today. Recommended: remove it in a separate change, to match the standing rule above.

## 16. Step 3.4 enforce applied to production (2026-11-24)

**User approval:** "i approve to apply the enforce flip" (after the readiness list in section 14 and section 15 was shown). Also: remove `register()`.

**Code.** `register()` removed from `artifacts/itam/src/lib/auth-context.tsx` (commit `639db96`, from the context type, the function, and the provider value). `/register` remains a redirect to `/login`. Typecheck clean; the itam suite passed (38 files, 389 tests). **The production build still contains the old code until a new production deployment is promoted from `639db96`. That promotion is not done and needs its own approval.**

**Pre-flip snapshot (2026-11-24 04:19:08 UTC).** Mode `shadow`. Gate rows: `cleared=15`. Profiles without a gate row: 0. `auth.sessions`: 0. Admitted rows: 0. Storage: 0 buckets, 0 objects, 0 policies (D8). Restrictive policies `password_gate_scope`: 11. Shadow log rows: 0.

**The flip.** `UPDATE public.password_gate_settings SET mode = 'enforce', updated_at = clock_timestamp() WHERE id = 1;` Read back at 04:19:13 UTC: `mode = enforce`, shadow log rows 0.

**Post-flip probe (rolled back, no data changed).** The probe ran as the `authenticated` role with the `admintest` user ID and no admitted session:

- `get_my_role()` returns NULL.
- `is_active_user()` returns false.
- `password_gate_scope_ok()` returns false.
- `tickets` visible: 0.
- `profiles` visible: 1 (the caller's own row, the self-read carve-out).

**Rollback (first step, per section 6).** `UPDATE public.password_gate_settings SET mode = 'shadow', updated_at = clock_timestamp() WHERE id = 1;`

**Still open after the flip:**

1. **Signed-in role matrix (section 7).** Not run. Run it now on the three dedicated accounts. Any write needs approval.
2. **Realtime check (4.7).** Not run. Subscribe as a restricted or unadmitted session to `notifications` and `profiles`, and confirm no business events arrive.
3. **Rate limiting and lockout (3.2).** Open. Not in the broker function.
4. **Production build of the `register()` removal.** Not promoted.
5. **Sign-ins from the broker.** Any session created outside the broker is denied from now on. Sessions were 0 at the flip, so nothing was cut off.

## 17. Rate limiting and lockout; signed-in matrix and Realtime (2026-11-24)

**Rate limiting and lockout: built, tested locally, not applied to production.**

- Migration `supabase/migrations/20261124051703_password_gate_login_throttle.sql` (service-only table `password_gate_login_throttle`, functions `password_gate_login_check`, `password_gate_login_failed`, `password_gate_login_succeeded`). Rollback: `supabase/rollbacks/20261124051703_password_gate_login_throttle.sql`.
- Rules: 5 wrong passwords in 15 minutes lock the email for 15 minutes. The lock is checked before the password goes to GoTrue, so a locked email gets 429 with `retry_after`, even with the right password. A correct password clears the count. After a lock expires, the count starts again. Keys are SHA-256 of `login:` + the lowercased, trimmed email. No email is stored or sent to the throttle.
- `login-broker` (source updated, **not deployed**): the lock check runs first and fails closed (503) on any error or any reply that is not a whole number. Failed passwords are counted. A GoTrue 5xx is not counted.
- Browser (`artifacts/itam/src/lib/login-broker.ts`): 429 `too_many_attempts` shows "Too many sign-in attempts. Wait a few minutes and try again." It needs a production frontend promotion.
- Tests: `login-broker-edge.test.ts` (30, +11 for the lock), `password-gate-login-throttle.local.test.ts` (10, PGlite), `login-broker.test.ts` (+1). Full itam suite: 39 files, 411 tests. `tsc --noEmit` clean.
- Trade-off, stated plainly: an attacker who knows an email can lock that account for 15 minutes by sending 5 wrong passwords. That is the cost of per-account lockout. It is limited to 15 minutes per window. There is no per-IP limit, because the Edge Function does not trust forwarded addresses (`security_sb_forwarded_for_enabled` is false).

**Order of production steps (each needs its own approval).** 1. Apply the migration. 2. Deploy `login-broker` v3. Deploying v3 before the migration makes every sign-in return 503, because the lock check RPC does not exist. 3. Promote a frontend built from a commit at or after `639db96`. This brings in the 429 message and the removed `register()`.

**Signed-in role matrix and Realtime check: not run by the assistant.** The sandbox cannot reach Supabase or the preview, and the assistant does not hold the dedicated accounts' passwords.

- Role matrix: `artifacts/itam/scripts/password-gate-signed-in-check.mjs`. It signs in the three dedicated accounts through the broker and checks each row of section 7 that can be checked by reading: admin, support, general user, unadmitted direct sign-in, anon, and a wrong password. `--lockout` also runs the lockout check, which locks the general test account for 15 minutes. It only reads, and it prints no passwords or tokens. It was checked against a local mock of the API (13 checks pass in the mock, including the unadmitted case that must fail if enforcement is broken). It has not been run against live.
- Still needed from you: run the script with the three accounts' credentials. The restricted-session rows of section 7 need a flagged dedicated account, and flagging one is a production write that needs approval.
- Realtime check (4.7): not run. It needs a Realtime client subscribed as a session that has no business access, to `notifications` and `profiles`, while a business row changes. Expected: no business events reach a restricted or unadmitted session. The positive control is a full session receiving its own notification. It also needs a flagged dedicated account.

## 18. Flagged test account; role matrix (database layer run, live browser run pending) (2026-11-24)

**Flag applied (approved by the user).** `usertest@gmail.com` (`general_user`, dedicated test account) was flagged in production: `password_gate_state.phase` `cleared` → `required` under a new operation ID, `profiles.must_change_password` set to true, and its admitted-session rows removed (there were none). Nothing else changed. Mode stays `enforce`. It is the only account in `required`. To restore it, the user completes the password change in the app; the change path then sets `cleared` and a new generation.

**Live check from the assistant: not possible.** The sandbox cannot reach Supabase or the preview (HTTP `000`, checked again). The assistant does not hold the dedicated accounts' passwords.

**Database-layer role matrix, run live and rolled back (2026-11-24).** Each probe ran as the `authenticated` role with a claim set, inside a block that always raised, so nothing was committed. The probe sessions and admitted rows were removed by the rollback (checked: 0 remain).

| Subject | Session | Tickets | Assets | Notifications | Profiles | Own-profile update |
| --- | --- | --- | --- | --- | --- | --- |
| Administrator (`admintest`) | full, admitted | 27 | 26 | 3 | 15 | n/a |
| General user (`usertest`), flagged | restricted, admitted | 0 | 0 | 0 | 1 (own) | 0 rows |
| General user (`usertest`), flagged | no session | 0 | 0 | 0 | 1 (own) | n/a |
| Administrator (`admintest`) | none | 0 | 0 | 0 | 0 | n/a |
| anon | none | 0 | 0 | 0 | 0 | n/a |

Not covered by this table: the general user with a full session (`usertest` is flagged, so this needs the password change first); the maintenance-RPC and ticket-create denials (not exercised, to avoid writes); the Realtime rows.

**Signed-in matrix, to run on your machine (required).** The script is `artifacts/itam/scripts/password-gate-signed-in-check.mjs`. Run it from a machine that can reach the project:

1. While `usertest` is flagged: `SUPABASE_URL=... SUPABASE_ANON_KEY=... ADMIN_EMAIL=admintest@gmail.com ADMIN_PASSWORD=... SUPPORT_EMAIL=supporttest@gmail.com SUPPORT_PASSWORD=... USER_EMAIL=usertest@gmail.com USER_PASSWORD=... USER_FLAGGED=1 node artifacts/itam/scripts/password-gate-signed-in-check.mjs`
2. Complete the password change for `usertest` in the app on the preview.
3. Run again with `USER_FLAGGED` unset and `USER_PASSWORD` set to the new password. This covers "after change: full access under the new generation" and the general-user rows.
4. Optional, locks `usertest` for 15 minutes: add `--lockout` to either run.

Expected: every line PASS. A FAIL is a finding. Do not continue to 3.4 sign-off on a FAIL.

**Realtime check (4.7): still not run.** It needs a Realtime subscription as the flagged `usertest` session (restricted), to `notifications` and `profiles`, while a business row changes. Expected: no business events. The positive control is a full session receiving its own notification. Send the results, and this becomes the next item.

## 19. Live lockout check in the app, usertest (2026-11-24)

**Run by the user, by hand, in the app on the preview, with the approved dedicated account `usertest@gmail.com`.** The user made wrong-password sign-in attempts for this account. The sign-in screen then showed "Too many sign-in attempts. Wait a few minutes and try again." (user screenshot). That is the 429 `too_many_attempts` path through the broker and the client message from `login-broker.ts`.

**Server state, read-only (2026-11-24, checked by the assistant).** Table `public.password_gate_login_throttle`, key `189a52f7…aaf` (SHA-256 of `login:usertest@gmail.com`):

- `failures` = 5
- `window_started_at` = 05:46:08 UTC; `updated_at` = 05:46:20 UTC
- `locked_until` = 06:01:20 UTC (15 minutes after the fifth failure)
- `seconds_left` = 478 at the time of the query

**Not recorded here:** the individual attempt results, the correct-password-while-locked result, and the check after the lock expires. The `--lockout` run of the script has not been done. The lock runs out at 06:01:20 UTC.

**Other results from the user, not recorded in detail.** Realtime (4.7) was reported as done, with no results sent. The signed-in role matrix (section 18, steps 1 to 3) has not been reported back. Both need results before they can be marked passed.

**Update (2026-11-24), after the lock expired.** The user reports that the correct password for `usertest@gmail.com` signed in successfully after the lock ran out. A read-only check afterwards found no throttle row for that key, so the count is back to zero. The correct-password-while-locked result was not recorded separately. The role matrix (section 18, steps 1 to 3) was reported as done by the user; the script output has not been received, so no result is recorded for it yet.

## 20. Realtime check, database-level (2026-11-24)

**Method.** The user chose a database-level check, because the sandbox cannot reach the live project or its Realtime websocket. The test uses the same row-level security that Realtime applies to `postgres_changes` events. It is not a websocket delivery test. The user approved one test write, but the probe rolled it back, so nothing was kept. The probe ran as the `authenticated` role with claims.

**Session.** The restricted-session test uses an unadmitted session: a `session_id` claim with no row in `password_gate_admitted_sessions`. The positive control uses a full session: a temporary admitted row for a temporary `auth.sessions` row, both in the rolled-back block.

**Test.** One notification for `usertest@gmail.com` was inserted, then the visibility of `notifications` and `profiles` was counted under each session.

| Session | Notifications for usertest visible | Profiles visible |
| --- | --- | --- |
| Unadmitted (restricted) | 0 | 1 (own) |
| Full (positive control) | 4 (3 existing plus the test row) | 15 |

**Rollback check.** The probe block always raised, so the transaction was rolled back. Afterwards: 0 probe notifications, 0 admitted rows, 0 temporary sessions for usertest, and 3 real notifications for usertest.

**Result.** Pass on the database-level rules. The unadmitted session gets no notification rows and only its own profile. The full session gets its notifications and all profiles. This shows the rule that Realtime would enforce, but not that events were delivered over the websocket. A live websocket test still needs the user's machine.

**Still open.** The role matrix results (the user reported it as done but has not sent the script output). The lockout check is recorded in section 19. The correct-password sign-in after expiry was reported as successful by the user.

## 21. Role matrix, database layer, current state (2026-11-24)

**Method.** The sandbox cannot reach the live broker or REST API, so the signed-in script (`password-gate-signed-in-check.mjs`) was not run. This is the database-layer equivalent, run as the `authenticated` role with claims. Each probe made temporary admitted sessions, and every probe rolled back. Afterwards there were no probe sessions or admitted rows. This covers the general user with a full session, which section 18 could not cover while the account was flagged.

| Subject | Session | Tickets | Other users' tickets | Assets | Profiles | Own notifications |
| --- | --- | --- | --- | --- | --- | --- |
| Administrator (`admintest`) | full | 27 | n/a | 26 | 15 | n/a |
| Support (`supporttest`) | full | 27 | n/a | 26 | 15 | n/a |
| General user (`usertest`) | full | 27 | 27 | 26 | 15 | 3 |
| General user (`usertest`) | unadmitted | 0 | n/a | 0 | 1 (own) | n/a |
| anon | none | denied (permission error) | n/a | n/a | n/a | n/a |

**Finding: the script's expectations for the full general user are out of date.**

- Tickets: `password-gate-signed-in-check.mjs` expects a full general user to see only their own tickets. The current policy is `tickets_select_scoped` = `is_active_user()` (migration `20261030000006_general_users_view_all_tickets.sql`). That migration records a product decision: every active user may view all tickets and comment threads. Under that decision the script's check fails, and the failure is the script's fault, not the policy's. Section 7 of this doc also still lists "read another user's ticket: denied", which is stale.
- Profiles: the script expects a full general user to see only their own profile. The current policy `profiles_select_authenticated` = `is_active_user()` OR own, so any active user sees all 15 profiles. I found no documented decision for this, so it needs a product decision before the script or the policy changes.
- Assets: the script does not check assets for a full general user. The 26 visible assets are recorded here so the decision covers them too.

**Not covered here.** The restricted (flagged) rows of section 7 need usertest flagged again, which is a second production write that needs approval. The write rows (maintenance RPCs, ticket create) were not exercised. The Realtime delivery and the live signed-in run are still open.

**Earlier note correction.** The probe in the first attempt showed "SUP t27 a26 p1…". The message was truncated, and the rerun with the role switch shows support sees 15 profiles, as the policy allows.

## 22. Visibility decisions; usertest flagged again; script updated (2026-11-24)

**Decisions from the user.**

- General user: all tickets (product decision, migration `20261030000006`, kept), only assets assigned to them, and only their own profile.
- Support: all tickets, all assets, and only their own profile.
- Administrator: unchanged.
- Flagging `usertest@gmail.com` again was approved and done: phase `cleared` → `required` under a new operation ID, `must_change_password` true, admitted rows removed (0). The user has to complete the password change in the app before the full general-user rows can run again.

**Script updated** (`artifacts/itam/scripts/password-gate-signed-in-check.mjs`, syntax checked, not run live):

- Support: all tickets and assets (counts match the administrator's), own profile only.
- General user (full session): all tickets (count matches the administrator's), only assets assigned to the user (every returned row assigned to the user, count matches the administrator's), own profile only.
- Flagged general user: unchanged (0 tickets, 0 assets, 0 notifications, own profile only).

**Current production does not match these decisions yet.** A live run now will FAIL on:

- General user: "only assets assigned to self" (26 assets visible; 0 are assigned to usertest).
- General user and support: "other profiles not visible" / "reads own profile only" (15 profiles visible to each).

These FAILs are the expected result until the visibility change is applied. They are the acceptance test for it.

**Not yet applied: the visibility migration.** Profiles and assets need changes. The `password_gate_scope` policy on `profiles` is an ALL policy, so narrowing `profiles_select_authenticated` alone does not work: a full session still matches the gate policy and sees every row. The migration would split the gate policy by command, keeping writes unchanged.

**Open decision before the migration.** The app reads other users' profiles in several places, so an own-profile-only rule blanks names:

- Ticket requester and assignee names (embedded profile joins in `tickets.ts` and `shared.ts`).
- Ticket comment author names (`ticket_comments` join).
- Support-staff list for assigning tickets (`useGetSupportStaff`, `profiles` where role = support_staff). Support users could not assign to other staff.
- Asset holder names for support (`assets` join).
- Requester name search (`tickets.ts`, `profiles` ilike).

Options: (a) a names-only directory (id, full name, role) that every active user can read, while email and other profile fields stay private; or (b) the strict rule, with the app changed to show "Unknown user" for other users and the staff list served another way. Option (a) departs from "should not see other profiles" in the strictest sense, so it needs the user's decision.

**Also stale:** section 7's line "read another user's ticket: denied" is out of date (see the decision on all tickets).

## 23. Visibility migration written and tested locally; not applied to production (2026-11-24)

**Files.**
- `supabase/migrations/20261124064640_password_gate_visibility_scope.sql`
- `supabase/rollbacks/20261124064640_password_gate_visibility_scope.sql`
- `artifacts/itam/src/lib/password-gate-visibility.local.test.ts` (12 tests, PGlite, applies every migration and the Step 3.3 proposals in production order, then enforce mode)

**What it changes (SELECT only; writes are unchanged).**

- Profiles: `profiles_select_authenticated` is replaced by `profiles_select_scoped`. A user sees their own profile. An administrator sees all profiles. Support staff and general users see only their own.
- Assets: `assets_select_authenticated` is replaced by `assets_select_scoped`. Administrators and support staff see all assets. General users see only assets assigned to them.
- Asset history and maintenance log: these now follow the asset they belong to (visible only when the asset is visible to the same user). This was not in the request; it applies the same rule so a general user cannot read history of assets they don't hold. It is included in this migration, and can be removed before applying if you do not want it.
- Tickets: unchanged (migration `20261030000006`, every active user sees all tickets).

**Why it is safe to replace these policies.** The `password_gate_scope` policies are RESTRICTIVE (checked in `pg_policies`), so the gate still narrows whatever the permissive policies allow. The gate policies are untouched.

**Test results (local).**
- `password-gate-visibility.local.test.ts`: 12 of 12 pass.
- `password-gate-phase3-step33.local.test.ts`: one assertion changed. The backfill test expected a general user to see all assets; it now assigns one seeded asset to that account and checks that exactly that asset is visible, then restores it. 19 of 19 pass.
- Full itam suite: 40 files, 423 tests pass. `tsc --noEmit` exit 0.

**Not applied to production.** The migration needs its own approval. Once applied, the script's general-user and support rows should pass; the current production state fails them (section 22).

**Consequences for the app, not changed by this migration.** Under the rule as decided, these lose names for the roles affected:

- Ticket requester and assignee names, and comment author names, for general users and support staff (embedded profile joins in `tickets.ts` and `shared.ts`).
- The support-staff list used to assign tickets (`useGetSupportStaff`). Support staff can no longer list other support staff; administrators still can.
- Asset holder names for support staff (asset joins in `assets.ts`).
- Requester name search (`tickets.ts`, profile ilike lookup), which now matches only the user's own name for non-administrators.

The app change for these is a separate piece of work, and the open decision from section 22 (names-only directory vs strict rule) is still open.

## 24. Profiles stay open; support can assign tickets (2026-11-24)

**Decisions from the user (supersede section 22 and the profile part of section 23).**

- General users and support staff see all profiles. Names are needed for ticket requesters and assignees, comment authors, asset holders and the support-staff list.
- Support staff can assign tickets to other staff.
- Unchanged from section 23: general users see only the assets assigned to them, and support staff and administrators see all assets. Every active user sees all tickets.

**What changed in the migration (`20261124064640`, still not applied to production).** The profiles policy is no longer touched, so the existing `profiles_select_authenticated` (every active user sees all profiles) stays. The migration now only narrows assets, asset history and maintenance log. The rollback has been trimmed to match.

**Name lookups.** The consequence listed in section 23 for profiles no longer applies, because profiles remain visible to every active user.

**Support assigning tickets.** Checked in the repository:

- `tickets_update_scoped` allows support staff to update any ticket.
- The `guard_ticket_update` trigger returns early for support staff, so it does not block reassignment.
- `update_ticket_with_activity` runs under the caller's row-level security, so support staff can use it. The assignment dropdown in `pages/tickets/detail.tsx` uses the support-staff list (`useGetSupportStaff`).
- The local test shows a support session can reassign a ticket, and a general user cannot reassign someone else's ticket.
- Not checked live.

**Tests.**
- `password-gate-visibility.local.test.ts`: 12 of 12 pass (includes profiles visible to general and support, and support reassignment).
- Full itam suite: 40 files, 423 tests pass. `tsc --noEmit` exit 0.

**Script (`password-gate-signed-in-check.mjs`).** The support and general-user rows now expect all profiles (count matches the administrator's). The general-user "own profile" row is renamed to "reads own profile", since it checks the user's own row. Syntax checked; not run live.

**Still needed.** Approval to apply `20261124064640` to production. Until then the live script's general-user asset row and support row fail (section 22 explains which).

## 25. Visibility migration applied to production (2026-11-24)

**Approved by the user.** Applied to production as migration `20261124064640_password_gate_visibility_scope` (the file was renamed to match the version assigned at apply). Listed in the production migration history.

**Applied policy changes (verified in `pg_policies`).**

- `assets`: `assets_select_authenticated` replaced by `assets_select_scoped`. Active administrators and support staff see all assets. Other active users see only assets assigned to them.
- `asset_history`: `asset_history_select_authenticated` replaced by `asset_history_select_scoped` (visible when the asset is visible).
- `asset_maintenance_log`: `maintenance_log_select_authenticated` replaced by `maintenance_log_select_scoped` (visible when the asset is visible).
- `profiles`: unchanged (`profiles_select_authenticated`: every active user sees all profiles).
- Tickets: unchanged.

**Rollback** (if the decision is withdrawn): `supabase/rollbacks/20261124064640_password_gate_visibility_scope.sql`.

## 26. usertest password change completed; general-user full session checked on production (2026-11-24)

**Password change.** `usertest@gmail.com` completed the password change at 07:03:07 UTC. Afterwards the gate phase is `cleared` and `must_change_password` is false (read-only check). The earlier change at 05:27:44 UTC was before the re-flag, so it did not clear the flag; the 06:28 re-flag needed this second change.

**General user, full session (rolled-back probe, production, after migration `20261124064640`).** Run as `authenticated` with a temporary admitted session, then rolled back.

| Subject | Tickets | Other users' tickets | Assets | Profiles | Own notifications |
| --- | --- | --- | --- | --- | --- |
| General user (`usertest`), full | 27 | 27 | 0 (none assigned to it) | 15 | 3 |

This matches the decisions: all tickets, no assets except those assigned to the user (none here), all profiles, and only its own notifications.

**Still to run.** The role-matrix script without `USER_FLAGGED`, for the live browser/broker run. The restricted (flagged) rows need usertest flagged again, which is a production write and needs approval.

## 27. usertest flagged again (approved); restricted rows checked on production (2026-11-24)

**Flag (approved by the user).** `usertest@gmail.com` moved from `cleared` to `required` under a new operation ID; admitted sessions removed (0); `must_change_password` true. The account needs a password change in the app before the full general-user rows can run again.

**Restricted rows (rolled-back probes, production, as `authenticated` with claims).**

| Session | Tickets | Assets | Notifications | Profiles |
| --- | --- | --- | --- | --- |
| No admitted session | 0 | 0 | 0 | 1 (own) |
| Restricted admitted session (`password_change_only`) | 0 | 0 | 0 | 1 (own) |

**Role-matrix script, live run: not done by the assistant.** The sandbox cannot reach the Supabase project (HTTP `000`, checked again). The restricted run needs the user's machine, with `USER_FLAGGED=1`.

**Order for the remaining live run.**
1. Run the script with `USER_FLAGGED=1` (restricted rows).
2. usertest completes a password change in the app. This clears the flag.
3. Run the script without `USER_FLAGGED`, with the new password (full general-user rows).

## 28. Live signed-in role matrix skipped (user decision); profile visibility gap found (2026-11-24)

**Skipped.** The user decided not to run the live signed-in role matrix (`artifacts/itam/scripts/password-gate-signed-in-check.mjs`), because they could not run it from PowerShell. The sections 26 and 27 results are database-level checks only: rolled-back probes as `authenticated` with claims, on production. They do not cover the browser UI or the login broker. Treat the signed-in matrix as not run.

**Correction to section 26.** Section 26 said the general user's 15 visible profiles "match the decisions". That was wrong against the latest rule. The latest rule (2026-11-24) is:
- General users see only their own profile.
- Support users see no profiles other than their own.
- Administrators keep full access.

**Gap on production.** Migration `20261124064640` leaves `profiles_select_authenticated` as `is_active_user() OR id = auth.uid()`. This lets every active user read all profiles, which is the revised rule the user superseded. Production has the wrong profile scope. Assets, asset history and maintenance-log scope match the latest rule.

**Status.** The profile fix is not written. It needs a new migration, a local PGlite test, and a separate production approval.

**usertest.** The flag from section 27 remains in place (`required`), so the account must change its password in the app before the full general-user checks can run again.

## 29. Profile visibility and support assignment confirmed (user instruction, 2026-11-24)

**Profile rule (user instruction, this turn).** General users and support staff see all profiles, so they can see other users' names in ticket requester and assignee fields, comment authors, asset holder names, and the support-staff assignment list. Administrators keep full access. This is the rule that production migration `20261124064640` applies (`profiles_select_authenticated` = active user or own profile). It is also what the local test `password-gate-visibility.local.test.ts` expects. The gap listed in section 28 is therefore not a gap. Section 28 is superseded on this point.

**Support can assign tickets to other staff (verified on production, rolled back).**
- The app assigns through `update_ticket_with_activity` (`artifacts/itam/src/lib/queries/tickets.ts`, around line 346). The RPC is on production as an invoker function.
- Neither the RPC nor `guard_ticket_update()` checks the assignee's role. Support returns early in the guard.
- The Assign To control shows to support (`canManage` includes support). Its list is active support staff plus administrators (`detail.tsx`, around line 84).
- Rolled-back probe as support staff: `update_ticket_with_activity` assigning a ticket to another active support staff member returned `assigned_match=true`. The probe ran in a transaction that was rolled back.

**Not run.** The live signed-in role matrix (section 28). The UI has not been exercised in a browser.

## 30. No redeploy needed; UI check not run from the sandbox (2026-11-24)

- **Redeploy.** The app code on production is from `4944fbe` (Vercel `dpl_8s7jcFURD7PjMbKM2GVWinmURd6k`, READY and PROMOTED). Since then, no app source file has changed; only test files, the signed-in check script, docs and the database migration (`20261124064640`, already applied) have changed. A redeploy would not change the running app, so none was made.
- **UI check.** Not run. The sandbox cannot reach the live app (HTTP `000`), and the test passwords are not held here. The user runs the UI check in the browser.
- **Live system state.** The profile rule (all profiles for general users and support staff) and support-to-support assignment are live through the database (section 29). usertest is still flagged (section 27) and must change its password in the app before it can sign in fully.

## 31. Browser UI checks passed (user report, 2026-11-24)

The user ran the browser checks in the app and reports all three pass:
1. **Support reassignment.** Support assigns a ticket to another support staff member. It saves and shows in the activity log.
2. **Names visible.** As general user and as support, requester, assignee and comment names show, and the support-staff list is visible.
3. **Assets.** As general user, only assigned assets are visible. As support, all assets are visible.

**usertest state (read-only check, production).** Phase `cleared`, `must_change_password` false, one admitted session. The account is no longer flagged.

**Still open.**
- The live signed-in role-matrix script (section 28). The user has not run it, and the UI checks above replace it for now.
- The lockout expiry, correct-password result, recorded in section 19 and earlier notes.

## 32. Lockout check closed: correct password accepted after expiry (user report, 2026-11-24)

After the `usertest` lock expired (section 19), a sign-in with the correct password succeeded. This closes the post-expiry item for the lockout check.
