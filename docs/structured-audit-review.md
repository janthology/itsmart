# Structured audit (`00019`) and retention preview (`00021`): review package

Status: **APPLIED to production on 2026-11-21**, after your approval of this SQL and rollback.

- `00019` applied as live migration `20261121160903 transactional_entity_audit`.
- `00021` applied as live migration `20261121160953 audit_retention_preview`.
- Verification (read-only and rolled-back probes): see section 7.
- Not authorized by this application: the admin audit viewer UI, any retention purge, any export, and any legal-hold policy.

Prepared 2026-11-21 against live `rkwxdqludtdzbpuftsvi` (read-only checks only).

## 1. What would be applied

| File | SHA-256 | Purpose |
| --- | --- | --- |
| `supabase/migrations/20261101000019_transactional_entity_audit.sql` | `c690caed…4656f` | New append-only table `entity_change_audit`, a trigger function `log_entity_change()`, and five AFTER triggers |
| `supabase/rollbacks/20261101000019_transactional_entity_audit.sql` | `da4c4e1e…654be` | Drops the five triggers and the function. Keeps the table, its rows, the read policy and the index |
| `supabase/migrations/20261101000021_audit_retention_preview.sql` | `fb739c82…70e0` | Read-only function `audit_retention_preview()` (administrators only) and an index on `occurred_at` |
| `supabase/rollbacks/20261101000021_audit_retention_preview.sql` | `6d240eb9…a5a5` | Drops the preview function and its index. Never deletes audit rows |

Read the full SQL in the repository files; the hashes above identify the exact versions. The applied function bodies match the repo: `log_entity_change` MD5 `551abb7d9a34ec2f99696ff6848365ae`, `audit_retention_preview` MD5 `294a696d6df3c469df275af5986e188f`.

## 2. Effect on production

**Tables written by the triggers:** `tickets`, `assets`, `ticket_comments`, `asset_history`, `asset_maintenance_log`. Every INSERT, UPDATE and DELETE on these tables writes one row to `entity_change_audit`. UPDATEs that change nothing write no row.

**Row counts before application (read-only, 2026-11-21):** tickets 27, assets 26, ticket comments 200, asset history 140, maintenance log 6. The table would start empty at the time of application, so the history begins at that point. Existing records are not backfilled.

**Who can read:** only active administrators, through RLS (`get_my_role() = 'administrator'`). Authenticated users have SELECT only at the grant level, and RLS narrows it further. No one, including administrators, can INSERT, UPDATE or DELETE audit rows through the API. The tests confirm that a direct DELETE is denied.

**Actor attribution:** `actor_id` is `auth.uid()` at the time of the write. Writes that come through the service role (for example Edge Functions) and writes with no signed-in user record `actor_id` as NULL. Writes that go through the anonymous role also have no actor.

**Sensitive content:** `old_values` and `new_values` store changed fields. For tickets and comments this includes names, descriptions and free-text remarks. For assets it includes asset details. Access is administrator-only, but the table holds personal and operational data for three years under the retention decision recorded from the user.

**Cost and performance:** every UPDATE on the five tables computes a JSON diff and writes a row when the stored row changes. Storage grows for as long as the table exists. There is no purge job. The preview function reports the count older than three years, but it does not delete anything.

**Correction (found during live probes):** the ticket table has a trigger that sets `updated_at` on every UPDATE. A change that only rewrites the same title therefore still changes `updated_at`, and the audit writes a row whose only changed key is `updated_at`. This is accurate for the stored data, but it means some rows will record no visible content change. The earlier statement that "UPDATEs that change nothing write no row" holds only where no column, including `updated_at`, changes.

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

## 6. Decisions (recorded)

1. Confirm that storing the changed field values of tickets, comments and asset history in an administrator-only table is acceptable, given the three-year retention decision.
2. Confirm that the audit covers only the five tables above. Writes by the service role will have no actor.
3. Confirm that no purge job is scheduled. The preview is for review only.
4. Confirm whether the admin audit viewer should be deployed later, as a separate change.

**Approval given:** on 2026-11-21 the user approved applying `00019` and `00021`. Applied as described in the status section.

## 7. Live verification after application (2026-11-21)

- Pre-check: all audit objects absent; latest live migration `20261121090050`; 20 migrations. Live history was 22 migrations after both applications.
- `log_entity_change`: `SECURITY DEFINER`, `search_path=pg_catalog, public`, body MD5 matches the repo file.
- `entity_change_audit`: RLS on. Only policy: `entity_change_audit_read_admin` (SELECT, administrators). `anon` has no SELECT. `authenticated` has no INSERT.
- Five triggers (`audit_ticket_change`, `audit_asset_change`, `audit_ticket_comment_change`, `audit_asset_history_change`, `audit_asset_maintenance_change`) enabled.
- Probes 1 and 2 (rolled back): a no-op `title = title` update on one ticket wrote one audit row. The only changed key was `updated_at`. This is the correction above.
- Probe 3 (rolled back, administrator): a title update on one ticket wrote one row with the administrator as `actor_id`. `audit_retention_preview()` returned one row to the administrator.
- Probe 4 (rolled back, general user): `audit_retention_preview()` was denied. The general user saw 0 audit rows.
- After the probes: 0 audit rows, 27 tickets, no probe titles left. All probes raised deliberately, so nothing committed.
- `audit_retention_preview`: `SECURITY INVOKER`, body MD5 matches, `authenticated` may execute, `anon` may not, index `entity_change_audit_occurred_at_idx` present.
- Live history after application: 22 migrations; latest `20261121160953 audit_retention_preview`.

**Not verified:** the admin audit viewer, which is not deployed. Writes from cron jobs will now be recorded, because the triggers apply to the ticket and asset tables that those jobs update. No retention purge exists.

**Rollback** (repository files, reviewed, not run): `supabase/rollbacks/20261101000019_transactional_entity_audit.sql` drops the five triggers and the function, and keeps the table and rows. `supabase/rollbacks/20261101000021_audit_retention_preview.sql` drops the preview function and index. Neither removes audit rows.
