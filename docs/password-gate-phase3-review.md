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

**Step 3.0 package (prepared 2026-11-23, not applied):**

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

- `MAINTAIN` (PostgreSQL 17) is granted to `authenticated` on the business tables. It allows VACUUM, ANALYZE and LOCK TABLE, but not row access. It is not in section 4.8. Recommended: add it, with your decision.
- Column-level ACLs on other public tables are not verified live. The Supabase API returned 502 on the two attempts to query `pg_attribute.attacl`. The snapshot captures them anyway, so the rollback is complete whatever the live check shows.
- `authenticated` still has column INSERT on `must_change_password` and `password_changed_at`, through the table-level INSERT grant. Revoking it would need the table INSERT replaced with an explicit column list. Not changed here. The risk is low: a locked account has an existing profile row, and DELETE on `profiles` is denied by RLS.
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

Decisions D1 to D8 were accepted on 2026-11-23. The step 3.0 package is written and tested locally (section 4.8). Before anything reaches production, it needs your approval of its SQL and rollback, and of the three extra changes listed there, including the decision on `MAINTAIN`. After that, the next packages are step 3.1 (schema), step 3.4 (helpers and policies), and step 3.2 (broker login). Each one needs its own SQL, rollback, local test and approval. Nothing is applied to production without a separate approval.
