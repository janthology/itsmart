# Pilot data wipe: DRAFT plan (not approved, nothing executed)

Status: **draft for review, 2026-11-21.** No deletion has been run or approved. This document does not authorize any write to `rkwxdqludtdzbpuftsvi` (`DOST02-ITSMART`).

The user has said the production database holds only test data and no real data yet, and that the pilot users' data will be wiped later. Per the user's instruction, this plan does not include backup or restore steps. A wipe is irreversible. Read-only inventories in this document are not recoverable backups.

## 1. Inventory (read-only, 2026-11-21)

Counts from the live database. Counts are approximate and may change while cron jobs run.

| Object | Rows | Notes |
| --- | --- | --- |
| `auth.users` | 15 | One identity row per user (`auth.identities`: 15) |
| `auth.sessions` | 0 | |
| `public.profiles` | 15 | 1 administrator inactive; 2 administrators active; 6 support staff active; 1 support staff inactive; 5 general users active. 0 flagged for password change. |
| `public.tickets` | 27 | |
| `public.ticket_comments` | 200 | Includes system comments (`is_system`) |
| `public.assets` | 26 | |
| `public.asset_history` | 140 | Actor references `changed_by` |
| `public.asset_maintenance_log` | 6 | |
| `public.notifications` | 238 | Cron `cleanup-old-notifications` removes rows older than 90 days |
| `public.sla_notification_deliveries` | 32 | Retry and deduplication state for SLA notices |
| `public.asset_creation_requests` | 0 | Idempotency records for asset creation |
| `public.admin_audit_log` | 7 | Administrator actions. See section 4. |
| `public.categories` | 0 | Legacy table |
| `public.asset_tag_counters` | 0 | Identifier allocation state |
| `public.ticket_number_counters` | 0 | Identifier allocation state |
| `storage.buckets` / `storage.objects` | 0 / 0 | No uploaded files to delete |
| `public` functions | 63 | Keep. Schema is not in scope for the wipe. |
| `public` triggers | 24 | Keep. |
| `cron.job` | 6 | See section 5 |

Applied migrations (live, latest last): `initial_schema` through `profile_password_flag_guard` (`20261121090050`), with the `sla_recipient_reopen_cycle` (`20261120203219`) step just before it.

## 2. Retained items (must not change)

Per the user's instruction, the following are kept as they are:

- The retained administrator's Auth identity, profile, role, active status and access.
- Schema, functions, triggers, RLS policies, grants and migration history.
- Configuration: Edge Functions (`change-password`, `create-user`, `reset-password`), Auth settings, Vercel project and production deployment.
- Cron job definitions (they may be paused only with a separate approval, section 5).

**Decision needed: which administrator is retained.** Two administrators are active and one is inactive. The inactive one must not be treated as the retained identity. The user must name the retained account by its exact email (not recorded here).

## 3. Deletion scope (proposed, not approved)

Delete pilot-user and test data in one transaction, in dependency order. Keep the retained administrator.

1. `public.sla_notification_deliveries`, `public.notifications`
2. `public.ticket_comments`, then `public.tickets`
3. `public.asset_history`, `public.asset_maintenance_log`, `public.asset_creation_requests`, then `public.assets`
4. `public.profiles` and `auth.users` / `auth.identities` for every account except the retained administrator. Delete Auth accounts with the Auth admin API, not raw SQL, and check each result.
5. `public.categories` (empty, optional).

Open questions for the user:
- Keep or reset `public.ticket_number_counters` and `public.asset_tag_counters`. Recommendation: keep them, so that identifiers used during testing are not reused in pilot history.
- Whether any profile other than the retained administrator must be kept (for example, a second administrator for the pilot).

## 4. Retention and audit decisions

- `public.admin_audit_log` (7 rows) records administrator actions. The stage 5 record notes a three-year audit retention decision from the user. **No audit purge mechanism is approved.** Recommendation: keep `admin_audit_log` through the wipe, and state explicitly whether these 7 test-era rows are kept as test evidence or removed.
- Deleting Auth users does not immediately invalidate JWTs already issued (Supabase documentation). Access tokens expire on their own schedule. This is a known limit, not a wipe step.
- The wipe must not remove audit rows that record the wipe itself. Record the wipe in `admin_audit_log` or in a dated note in the deployment record, with counts before and after.

## 5. Cron jobs during the wipe

| Job | Schedule | Effect |
| --- | --- | --- |
| `sla-at-risk` | `*/30 * * * *` | Creates SLA notifications |
| `sla-breached` | `*/15 * * * *` | Creates SLA notifications |
| `auto-close-resolved-tickets` | `0 * * * *` | Changes ticket status |
| `asset-pm-notifications` | `15 * * * *` | Creates PM notifications |
| `cleanup-old-notifications` | `15 3 * * *` | Deletes old notifications (harmless during the wipe) |
| `cleanup-cron-job-run-details` | `0 3 * * *` | Deletes old cron run records |

Plan: pause the four writing jobs (`active = false`) for the wipe window, then re-enable them unchanged. Pausing needs a separate approval. Do not unschedule or edit the jobs.

## 6. Sequence (once approved)

1. Confirm the retained administrator and every approval in section 7.
2. Announce a write freeze to pilot users, or confirm none exist.
3. Pause the four writing cron jobs. Record the time.
4. Record counts from section 1 (before).
5. Run the deletion in section 3 inside a single transaction. Check each count against the expected value. Commit only if all checks pass.
6. Delete Auth accounts other than the retained administrator, one by one. Record each result. Stop on the first unexpected response.
7. Re-enable the four cron jobs. Record the time.
8. Record counts (after). Confirm the retained administrator can sign in and that the audit log has the wipe record.
9. Record the outcome in `docs/deployment-record-2026-10-28.md` with the commit, counts and times.

Dry run: before production, run the same SQL against a disposable local PostgreSQL (the `artifacts/itam/scripts/test-security-concurrency.mjs` pattern). Never run `supabase db reset --linked` or any destructive command against production.

## 7. Approvals required before any step

- Written approval of the deletion scope in section 3.
- Named retained administrator (section 2).
- Decisions on counters, audit rows and any extra retained profiles (sections 3 and 4).
- Approval to pause the four cron jobs (section 5).
- Approval of the wipe window and the notice to pilot users.
- Approval of the Auth deletion method (Admin API, one account at a time).

## 8. Prerequisites that are still open

- **Edge Function drift: resolved 2026-11-21.** `reset-password` (v5) and `create-user` (v4) now run the repo source, byte-identical after deploy. The previous live versions matched commit `c6f746c`. See `docs/deployment-record-2026-10-28.md`. Live Auth paths are still not exercised from the sandbox.
- **Second live password change** on a different account has not been done. The only live evidence is `test4@gmail.com`.
- **Production preview behind Vercel SSO** has not been checked from the sandbox.
- **Trusted password gate** is not complete. The `00022` trigger blocks direct flag writes, but the server path (`change-password`) has one live test only.

## 9. Rollback

- Data: none. The wipe is irreversible, and this plan adds no restore step by instruction.
- Configuration: the cron jobs are re-enabled in step 7. Schema and functions are not changed by this plan. Rollback of Edge Functions and the frontend is as in `docs/deployment-record-2026-10-28.md`.
