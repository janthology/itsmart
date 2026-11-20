# Production configuration inventory (read-only)

This captures the **pre-stage-one-migration** configuration as a point-in-time reference, **not a backup**, restore image, complete schema dump, or proof that repository definitions match production. It contains no user records, credentials or secrets. Configurations may change; recheck them immediately before a deployment. Managed Auth/Storage schemas, all grants, extensions, external services, secrets and project settings are not exhaustively inventoried. Hashes identify observed definitions but cannot restore them. Never apply repository migration files wholesale to production.

## Deployment and project

- Supabase project `DOST02-ITSMART`, ref `rkwxdqludtdzbpuftsvi`, region `ap-southeast-1`; database reports PostgreSQL 17.11.0.003. Only this project was inspected. Do not modify the old project.
- GitHub deployments API last reported a production deployment for commit `a8e720400d8972e5cc6efdec0ffdf2947402666a` and older production entries for `fbd5988` and `26f85b1`. This is deployment metadata, not proof of the code currently served or of domain aliasing; confirm the active Vercel deployment/domain independently before rollout.
- Earlier preview deployments include `75d6444`, `f2d98d2`, `d5fbab2`. Automatic Vercel deployments are disabled in `vercel.json` for session branch `arena/fbb1e145-itsmart`; no deployment of `96ae478` was returned in the latest deployment listing.
- Active Edge Functions: `create-user` version 3, `reset-password` version 4; both have `verify_jwt=false` and verify the bearer and active administrator in their function code. Their checked-in source is under `supabase/functions/`; deployed source equivalence was not established by the metadata listing.

## Migration history observed in production

| Supabase version | Name |
| --- | --- |
| 20261029083419 | initial_schema |
| 20261029084914 | safe_p0_hardening_rls_and_cron |
| 20261029154519 | fix_profiles_with_email_lints |
| 20261029180104 | auto_close_resolved_tickets |
| 20261029181126 | auto_close_closing_reason |
| 20261030092455 | general_users_view_all_tickets |
| 20261030162702 | phase2_indexes_and_notification_retention |
| 20261031093713 | admin_audit_log |
| 20261112003732 | asset_maintenance_workflow |
| 20261112003902 | maintenance_legacy_cutover |
| 20261112003952 | legacy_unassignment_history |
| 20261112004126 | return_asset_to_service |
| 20261112010318 | complete_maintenance_cutover |

The prepared `ticket_and_asset_write_guards` migration is absent. Repository filename timestamps differ from these production version IDs.

## Cron jobs observed

All listed jobs were active. Schedule interpretation depends on the server's cron timezone, which was not verified here.

| Job | Schedule | Command |
| --- | --- | --- |
| asset-pm-notifications | `15 * * * *` | `SELECT public.generate_pm_notifications()` |
| auto-close-resolved-tickets | `0 * * * *` | `SELECT public.auto_close_resolved_tickets()` |
| cleanup-cron-job-run-details | `0 3 * * *` | `DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'` |
| cleanup-old-notifications | `15 3 * * *` | `SELECT public.cleanup_old_notifications(90)` |
| sla-at-risk | `*/30 * * * *` | `SELECT public.notify_sla_at_risk()` |
| sla-breached | `*/15 * * * *` | `SELECT public.notify_sla_breached()` |

## Public RLS policies observed

RLS was enabled, but not forced, on all nine public tables listed here. All 29 policies were permissive. This is a summary; the exact expressions, table/column grants, trigger behavior and role membership all matter. For precise reconstruction query `pg_policies` and the relevant grants directly before any approved change.

| Table | Policies and observed intent |
| --- | --- |
| admin_audit_log | `admin_audit_insert_admin` (administrator and actor=self); `admin_audit_select_admin` (administrator). Both are granted to `public`. |
| asset_history | `asset_history_delete_admin`, `asset_history_insert_staff`, `asset_history_select_authenticated`. Insert checks staff role, not actor identity. |
| asset_maintenance_log | `maintenance_log_delete_admin`, `maintenance_log_select_authenticated`; no direct insert policy observed. |
| assets | `assets_delete_admin`, `assets_insert_staff`, `assets_select_authenticated`, `assets_update_staff`. |
| categories | `categories_delete_admin`, `categories_insert_staff`, `categories_select_authenticated`, `categories_update_staff`. |
| notifications | `notifications_delete_own`, `notifications_insert_own`, `notifications_select_own`, `notifications_update_own`; insert also requires active user. |
| profiles | `profiles_insert_self` (own id/general role), `profiles_select_authenticated` (active or self), `profiles_update_self_or_admin` (active self or admin). |
| ticket_comments | `ticket_comments_delete_admin`, `ticket_comments_insert_scoped` (active, own author, non-system; staff or creator/assignee), `ticket_comments_select_scoped` (active). |
| tickets | `tickets_delete_admin`, `tickets_insert_authenticated` (active, own creator or staff), `tickets_select_scoped` (active), `tickets_update_scoped` (active, staff or creator). |

Except the admin audit policies, the listed policy roles were `authenticated`. General users may read organization-wide tickets and comments; their writes remain scoped. See audit and checked-in migration sources for more context, not as a guarantee of live equivalence.

## Public database function fingerprints

Signatures and MD5 of `pg_get_functiondef`; extension-owned functions excluded. All are SECURITY DEFINER except `skip_false_maintenance_unassignment`, `sla_hours`, `touch_ticket_last_activity`, `update_updated_at_column`, and `validate_asset_pm_dates`.

```text
auto_close_resolved_tickets() 7c248ce411fd7fa883771338cece3bcb
cleanup_old_notifications(integer) a240b2c13d5b6f892b227adf03e6cd08
correct_asset_maintenance(uuid,uuid,text,text) 594c55a1a3def6c1f8d9ad14f894df39
generate_pm_notifications() d1e8b977d351e69c1ebdff60c527922b
generate_ticket_number() 0fcd669812282af4170226b9bfe7deca
get_my_role() ccb01fb68787576c2b35553d806d8280
guard_profile_update() 0c0a7cebfe88ab06f77b4b97c8d91490
guard_ticket_update() 1753643b510fb801e544ff051f47eda5
handle_new_user() 71b2b2ae6f061c7e018fcb39b3ade331
is_active_user() 52f98a52eadabcc1ea3e648d517db7ac
notify_asset_assigned() 707124dec5140dae2c37a2a773c2c25e
notify_sla_at_risk() 38fbb9b058a141163d947d95a82e190e
notify_sla_breached() a08f718268217b62976e75424a647e63
notify_ticket_assigned() a575d1167a88b9b7787f72102ee3bc62
notify_ticket_comment() 16eb72dce9de402e05cf524c6983bc39
notify_ticket_update() 6d535d38403f009739251db11edde063
record_asset_maintenance(uuid,text,date,uuid,text,date,uuid) ebf849829c8485f52f55bbea9ff24024
return_asset_to_service(uuid) 23e8a11a3d0d8c6bc8dca357ad88523d
skip_false_maintenance_unassignment() 03c0466bef9b5f6b6f6aed5a811cf586
sla_hours(ticket_priority) 8ebafee715f2309b6d102fe96a1c0f19
sync_profile_contact_from_auth() 0cbcf0240ad9d2bdf62a5073336b1e26
sync_role_to_auth() 4416a513e4ca47fd5f1595f8b8eefaff
touch_ticket_last_activity() 46496d95ce4f7cc2d98782e5fa492217
touch_ticket_on_comment() 80ae9d5690de3b546e7d68efb0d41b4f
update_asset_pm_schedule(uuid,date,date,boolean,date,date,boolean) 27bba59550cc71495a6305e9d040fbca
update_updated_at_column() 0baeb88a1e07ab241c21827b3c4c15f8
validate_asset_pm_dates() f9493e889b51df1f9fa4bd119477bfc1
```

Public non-internal trigger inventory: asset_history `skip_false_maintenance_unassignment`; assets `trg_notify_asset_assigned`, `update_assets_updated_at`, `validate_asset_pm_dates`; profiles `on_profile_role_change`, `trg_guard_profile_update`, `update_profiles_updated_at`; ticket_comments `trg_notify_ticket_comment`, `trg_touch_ticket_on_comment`; tickets `set_ticket_number`, `trg_guard_ticket_update`, `trg_notify_ticket_assigned`, `trg_notify_ticket_update`, `trg_touch_ticket_last_activity`, `update_tickets_updated_at`. Managed-schema triggers were not inventoried here.

## Subsequent change: first guard migration

After the user approved proceeding without a verified backup, `ticket_and_asset_write_guards` was applied as version `20261119024510`. See `security-remediation-stage-1.md` for post-apply fingerprints, verification limits and rollback. The policy names and cron schedule listed above remained unchanged during post-apply checks; the trigger and function inventory above reflects the earlier baseline, not the new guard.

After separate approval of repository migration `00018`, `create_asset_atomically` was applied as live version `20261120083024`. Postflight and its limitations are recorded in `vercel-preview-readiness.md`. After another separate approval, `00020 ticket_change_with_activity` was applied as live version `20261120133730`; see `security-remediation-stage-5.md`. Following the later request to perform and deploy the fixes, `00015` and `00016` were also applied as `20261120194748` and `20261120194900`. See `production-remediation-november-20.md` for preflight, postflight, rollback risks and outstanding work. The original inventory above predates these changes. No data wipe or frontend deployment was performed.
