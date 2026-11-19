# Security remediation — stage 1 (deployed; live role checks pending)

## Status and baseline

The user explicitly approved the first migration after accepting the absence of a verified backup. `ticket_and_asset_write_guards` was applied to `DOST02-ITSMART` as Supabase migration **20261119024510**. No rollback, Edge Function deployment, intentional row modification or pilot reset was performed. The report-error UI and other frontend changes remain unconfirmed as deployed.

Post-apply read-only checks confirmed the enabled `a_guard_ticket_insert` trigger, updated ticket and asset function definitions, unchanged relevant policies, unchanged maintenance RPC fingerprints and six active cron jobs. Auth, database, REST, pooler and storage health checks reported healthy. Ticket/asset/history/profile counts were unchanged between immediate observations (27/26/140/12; maintenance logs 6). These checks are not proof of production role behavior: authenticated end-to-end checks are still pending, and counts do not prove row contents are unchanged. There is no verified restorable backup.

The target project identified by the connector is `DOST02-ITSMART` (`rkwxdqludtdzbpuftsvi`). Read-only baseline inspection returned 27 tickets, 200 comments, 26 assets, 140 asset-history entries, 6 maintenance logs and 12 profiles; these are point-in-time counts, not a backup, and may change. No verified restorable backup was created by this work. Live migration names match the repository through `complete_maintenance_cutover`, but the live versions differ from the repository filenames. Do not run a blanket `supabase db push` or migration-history repair without a separately reviewed reconciliation.

The observed live `pg_get_functiondef` MD5 fingerprints before deployment were:

| Function | MD5 |
| --- | --- |
| `generate_ticket_number` | `0fcd669812282af4170226b9bfe7deca` |
| `guard_ticket_update` | `1753643b510fb801e544ff051f47eda5` |
| `touch_ticket_last_activity` | `46496d95ce4f7cc2d98782e5fa492217` |
| `validate_asset_pm_dates` | `f9493e889b51df1f9fa4bd119477bfc1` |

These describe the **pre-deployment** state; relevant triggers, grants and policies must be rechecked immediately before any future deployment. A mismatch means stop and review, not overwrite. MD5 here is a drift fingerprint, not a security signature or a substitute for comparing definitions. Read-only inspection found no currently resolved or closed ticket with an open `on_hold_at`; recheck before rollout.

## Prepared change

`supabase/migrations/20261101000014_ticket_and_asset_write_guards.sql`:

- Adds a before-insert guard, ordered ahead of the ticket-number generator. General users can create their own open, unassigned tickets without supplying lifecycle fields or a ticket number; their create/activity timestamps are server-set.
- Protects general-user ticket identity, core metadata, creation and hold timing. For their existing allowed resolved-to-closed/reopen transitions, it sets the affected lifecycle times on the server, retains the assignee, and continues to allow CSAT on resolved/closed tickets. Existing organization-wide read access remains unchanged. Existing comment/activity and update-time triggers remain in use.
- Prevents support-staff asset inserts from specifying a non-active initial status or an assignee, closing the insert bypass of the existing administrator-only update guard. A support-created active, unassigned asset remains allowed; maintenance and PM policies are unchanged.
- Leaves staff ticket transitions and direct asset-history policies unchanged for the later transactional/audit stage. It does **not** enforce the mandatory-password flag, protect all staff-supplied lifecycle values, implement a safe ticket-number allocator, or change session behavior.

The test model is a simplified isolated PostgreSQL/PGlite schema that uses the actual old migration functions/policies and applies this prepared migration. It tests denied and allowed writes, trigger order, ordinary ticket generation, CSAT, closure/reopen, the security-definer comment activity trigger, support asset restrictions and retained support ticket Type changes. The rollback file is also executed in that model. It is not a full Supabase/Auth integration test and cannot by itself establish live compatibility or concurrency safety.

## Expanded local schema test

`artifacts/itam/src/lib/full-schema.local.test.ts` starts a disposable in-memory PGlite database, creates synthetic Auth/cron/publication shims, and applies **all repository migration files in order**, including the prepared guard. Six local tests cover ticket permissions, notifications via comment triggers, support maintenance, preventive PM idempotency and retained assignment, return-to-service, cross-user writes, and the rollback. The database contains synthetic data only and is destroyed after the run.

This is stronger than the earlier reduced-schema test, but it is **not** the Supabase stack: Auth is a stub (no GoTrue/JWT authentication), cron schedules do not execute, publication is not real Realtime, and the PostgREST gateway, hosted extensions, concurrent multi-session behavior and cloud configuration are not tested. The repository schema may also differ from live. It is not a backup or a verified restore.

## Original prerequisites and cutover proposal (historical)

1. Originally recommended: obtain and verify a restorable backup, including Auth and database data; confirm owner and restoration procedure. Do not treat row counts, migration files or this document as a backup.
2. Test the migration and rollback in an isolated production-like Supabase environment using disposable accounts for every role, including existing frontend flows, comment triggers, notification creation, auto-close, maintenance, deactivated users and service-role/cron operations. A Supabase branch was previously unavailable on the current plan. If full staging remains unavailable, document that limitation and obtain an explicit risk decision rather than claiming a full integration test.
3. Recheck live definitions/fingerprints, applied migration names, row invariants and deployed frontend. Ensure no resolved/closed legacy records with an open hold require special handling. Obtain explicit approval for the exact migration and rollback.
4. Apply the reviewed migration through a controlled, transactional management migration only after approval; do not use the mismatched repository history as an automatic push. Record the resulting remote version and verify that policies, triggers and intended role actions still work. Do not alter existing records to make tests pass.
5. Monitor application errors and user reports; ask users with stale sessions to reload if needed. Report the result and leave the pilot reset on hold.

## Post-deployment identifiers

| Function | Post-deployment MD5 |
| --- | --- |
| `guard_ticket_insert` | `203db2f2ccb81e8aab14992d066ac71c` |
| `guard_ticket_update` | `d1ff5837272ff3fe4fb27449a0d697c0` |
| `validate_asset_pm_dates` | `c71ab09a1e63a97e5afbd09b78df42a7` |

Existing ticket-number, last-activity and maintenance RPC fingerprints matched their pre-deployment values. The recorded pre-deployment hashes above and rollback source do not prove all production objects are restorable.

## Rollback

`supabase/rollbacks/20261101000014_ticket_and_asset_write_guards.sql` removes the new insert trigger/function and restores the repository's prior ticket and asset trigger functions. Validate its definitions against the live pre-change definitions before any deployment. It changes no data, but **reopens the documented ticket timing/insert and support asset-insert authorization gaps**. Roll back only for an approved incident and track re-hardening. A frontend rollback does not automatically revert this database change.

## Other work and open decisions

The report page now displays an error and retry action and hides the export controls if the active report query fails, rather than presenting an empty result. Tests cover ticket, inventory, history, performance and user-activity data sources with mocked failures. This is not a live integration test.

Mandatory password enforcement; admin reset/create partial-failure recovery; staff ticket transition enforcement; transactional asset/ticket audit; SLA recipient deduplication; safe number generation; migration-history reconciliation; dependency remediation; CSP reporting; verified backup/restore; and production integration remain open. The retention/deletion policy for history and maintenance records also needs an explicit decision before its permissions are changed.

## Local-only ticket partial-success mitigation

Ticket status, priority and assignment changes still perform separate update and activity requests. The locally prepared UI now checks for a returned updated row, refreshes after errors, and warns when the activity response is unconfirmed; the intended activity text stays on the page until dismissed or navigated away. Status remarks are also retained on the page when the update outcome is uncertain. It never silently retries a potentially committed activity request. Ticket type changes now report unconfirmed errors. Synthetic browser tests cover success, zero rows, network failure, and activity failures for all three actions. This is a mitigation, not transactional audit integrity; an atomic server-side design, concurrency tests, and deployment verification remain open.

Automatic Vercel deployments from this session branch are disabled in `vercel.json` so the required branch push does not intentionally deploy the local-only work. This does not change other branch deployment settings; confirm the deployment result rather than assuming.

## Local-only create-user partial-failure mitigation

`supabase/functions/create-user/index.ts` verifies the returned profile id, role, active flag and password-change flag. If setup is unconfirmed after a known newly created Auth ID, it requests Auth cleanup, distinguishes a successful cleanup response from a failed/lost one, and never returns the temporary password on those errors. An unknown Auth creation outcome is flagged without blindly retrying or deleting an unknown ID. The admin UI warns and blocks retry until the operator acknowledges checking Auth and the profile; a lost client response is similarly treated as uncertain. Warnings live in browser memory, not a durable reconciliation queue. Cleanup can fail or be ambiguous and Auth/profile operations are not atomic. The flag itself remains a frontend gate, not a trusted password-change enforcement boundary.

The new function and UI are **not deployed**. The live create-user function remained version 3 at read-only inspection, with in-function admin authorization and `verify_jwt=false`. For any later rollout, re-read the exact deployed function source/config, evaluate the account-deletion compensation and its constraints with the operator, test using isolated accounts, deploy the compatible UI before the new function, and keep a reviewed copy of the actual deployed source for rollback. Rollback of the function does not undo Auth/profile changes and restores the old failure-handling gaps. Do not log or store generated passwords.
