# Structured audit (`00019`) and retention preview (`00021`): review package

Status: **NOT applied to production.** Waiting for your explicit approval of the exact SQL and rollback below. This document does not authorize applying them, and it does not authorize the admin audit viewer or any retention purge.

Prepared 2026-11-21 against live `rkwxdqludtdzbpuftsvi` (read-only checks only).

## 1. What would be applied

| File | SHA-256 | Purpose |
| --- | --- | --- |
| `supabase/migrations/20261101000019_transactional_entity_audit.sql` | `c690caed…4656f` | New append-only table `entity_change_audit`, a trigger function `log_entity_change()`, and five AFTER triggers |
| `supabase/rollbacks/20261101000019_transactional_entity_audit.sql` | `da4c4e1e…654be` | Drops the five triggers and the function. Keeps the table, its rows, the read policy and the index |
| `supabase/migrations/20261101000021_audit_retention_preview.sql` | `fb739c82…70e0` | Read-only function `audit_retention_preview()` (administrators only) and an index on `occurred_at` |
| `supabase/rollbacks/20261101000021_audit_retention_preview.sql` | `6d240eb9…a5a5` | Drops the preview function and its index. Never deletes audit rows |

Read the full SQL in the repository files; the hashes above identify the exact versions.

## 2. Effect on production

**Tables written by the triggers:** `tickets`, `assets`, `ticket_comments`, `asset_history`, `asset_maintenance_log`. Every INSERT, UPDATE and DELETE on these tables writes one row to `entity_change_audit`. UPDATEs that change nothing write no row.

**Current row counts (read-only, 2026-11-21):** tickets 27, assets 26, ticket comments 200, asset history 140, maintenance log 6. The table would start empty at the time of application, so the history begins at that point. Existing records are not backfilled.

**Who can read:** only active administrators, through RLS (`get_my_role() = 'administrator'`). Authenticated users have SELECT only at the grant level, and RLS narrows it further. No one, including administrators, can INSERT, UPDATE or DELETE audit rows through the API. The tests confirm that a direct DELETE is denied.

**Actor attribution:** `actor_id` is `auth.uid()` at the time of the write. Writes that come through the service role (for example Edge Functions) and writes with no signed-in user record `actor_id` as NULL. Writes that go through the anonymous role also have no actor.

**Sensitive content:** `old_values` and `new_values` store changed fields. For tickets and comments this includes names, descriptions and free-text remarks. For assets it includes asset details. Access is administrator-only, but the table holds personal and operational data for three years under the retention decision recorded from the user.

**Cost and performance:** every UPDATE on the five tables computes a JSON diff and writes a row. Storage grows for as long as the table exists. There is no purge job. The preview function reports the count older than three years, but it does not delete anything.

**Not included:** the admin audit viewer UI, any retention purge, any export, any legal-hold policy and any cron job. The viewer is prepared locally only and is not deployed.

## 3. Pre-apply checks (read-only, live)

- `entity_change_audit`: absent. `log_entity_change`: absent. `audit_retention_preview`: absent. No triggers named `audit_%`. No index named `entity_change_audit%`. No name collisions.
- `get_my_role()`: present, which the RLS policy and the preview depend on.
- The migrations `20261101000018` and `20261101000020` were applied under live versions `20261120083024` and `20261120133730`. Neither is changed by this package.
- Current live migration history ends with `20261121090050 profile_password_flag_guard`. Applying `00019` would be a new live version. It must not reuse or rename an existing one.

## 4. Local verification (repo, synthetic data)

- `artifacts/itam/src/lib/full-schema.local.test.ts` applies every repository migration in order into disposable PGlite, then exercises the audit stream. This includes trigger attribution, no-op updates, denied DELETE, the preview's administrator-only check, the three-year cutoff, and the rollback script. 25 tests passed.
- The full local suite on the clean tree at `c7cc5d7` plus the CSP work in this review cycle: 30 files, 253 tests, and `tsc --noEmit` exit 0. `full-schema.local.test.ts` is 28 of those tests.
- Limit: PGlite is not Supabase. It does not test PostgREST, GoTrue, the hosted grants, or concurrent production load. A disposable PostgreSQL run with a concurrency script exists (`artifacts/itam/scripts/test-security-concurrency.mjs`). It is destructive and must be pointed only at a fresh local database.

## 5. Rollback

- `00019` rollback: drops the five triggers and `log_entity_change()`. Writes after the rollback are not recorded. Existing audit rows, the read policy, the index and the sequence are kept.
- `00021` rollback: drops `audit_retention_preview()` and its index. No rows are removed.
- Neither rollback removes audit rows. Deleting audit rows would be a separate retention decision, and none is approved.

## 6. Decisions needed before approval

1. Confirm that storing the changed field values of tickets, comments and asset history in an administrator-only table is acceptable, given the three-year retention decision.
2. Confirm that the audit covers only the five tables above. Writes by the service role will have no actor.
3. Confirm that no purge job is scheduled. The preview is for review only.
4. Confirm whether the admin audit viewer should be deployed later, as a separate change.

**Approval needed:** apply `00019` and `00021` to production, using the SQL in section 1, with the rollbacks in section 5, as new live migrations. Name them so they do not collide with existing live versions.
