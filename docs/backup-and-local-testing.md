# Backup and isolated testing: practical next steps

The production pilot database has **not** been backed up or reset by this work. Do not apply the prepared database migration until an appropriate recovery point has been created and its restoration verified, and the migration/cutover has been separately approved.

## 1. Choose a backup route

- **Managed backup:** In the Supabase dashboard, open `DOST02-ITSMART` → Database → Backups and check what your current plan actually offers. If an appropriate downloadable or restorable backup is available, an authorized project owner can capture it and verify restoration in a separate disposable environment. Do not press a restore button against the production project.
- **Private logical export:** If managed download/restore is not available, an authorized operator can use Supabase CLI / PostgreSQL `pg_dump` from their own machine and store the result encrypted outside this repository. This requires a compatible PostgreSQL client/network and privately held project database credentials; do not paste credentials, connection strings, hashes, API keys or backup files into chat or Git. Supabase's default CLI dump excludes managed schemas such as Auth and Storage and does not include data by default: a default schema dump alone is **not** a complete recovery backup. Plan and verify the exact capture and restoration of the application schemas/data, relevant roles/grants, Auth users/identities and custom Auth triggers; coordinate with an experienced database administrator before exporting or importing managed schemas.
- Paid plans or a separate test project may incur charges or need organization-owner approval. None were created or upgraded automatically. Supabase notes Free-plan dashboard backup downloads are unavailable in its production checklist; confirm current offerings in your dashboard.

The backup procedure must separately account for Storage objects, Edge Function source/configuration and secrets, Auth settings, scheduled jobs, policies and project settings. A database dump is not automatically a complete capture of all of these. A dump containing Auth tables may contain password hashes and other sensitive information; restrict access, encrypt it and keep it out of this checkout. Existing repository migrations and row counts are not backups.

## 2. Verify, rather than just create

A backup is not verified simply because a file exists. Restore it **only to a separate, disposable environment**, never over `DOST02-ITSMART`, and confirm the restore completed, schema/constraints/policies/functions and representative row counts match, required user identities and sign-in behavior work using authorized test accounts, and external configuration and any Storage objects are recoverable. Test procedures must not expose or alter real users' credentials. Record backup time, scope, protected storage location, restore result and operator; do not include secret values.

A full restore into another Supabase environment has managed-schema, versions, triggers, role, secret and token considerations; an experienced operator should adapt the vendor guidance. Existing sessions may not remain valid across projects. If a safe independent target cannot be provisioned, keep the backup and clearly label it **unverified**; do not claim restoration has been tested.

## 3. What we can do without a cloud test project

The repository has a synthetic in-memory PostgreSQL test (`artifacts/itam/src/lib/full-schema.local.test.ts`). It runs the checked-in migrations and prepared migration on synthetic data, including rollback tests. Run with `corepack pnpm --filter @workspace/itam exec vitest run src/lib/full-schema.local.test.ts` after installing dependencies. This has no external database connection and no real user data.

The Auth, cron and Realtime-related parts are shims; GoTrue, PostgREST, actual Realtime delivery, live cron execution, deployed Edge Functions and real multi-session concurrency are not verified. A local Docker-based Supabase stack or separately provisioned test project would provide stronger integration coverage. Keep production credentials out of local test configuration, and never use `--remote`, `--linked`, or production database URLs with destructive reset commands.

## References

- Supabase production checklist: https://supabase.com/docs/guides/deployment/going-into-prod
- Supabase CLI `db dump` limitations: https://supabase.com/docs/reference/cli/supabase-db-dump
- Supabase guidance on migrating Auth users: https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects
- Local development and CLI safety distinctions: https://supabase.com/docs/guides/local-development/cli-workflows
