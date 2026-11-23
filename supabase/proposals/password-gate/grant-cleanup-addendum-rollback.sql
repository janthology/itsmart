-- Rollback for supabase/proposals/password-gate/grant-cleanup-addendum.sql.
-- Restores MAINTAIN on tables and default privileges, and table-level INSERT on
-- profiles, from private.grant_cleanup_addendum_snapshot. Refuses to run without a
-- snapshot. Does not touch rows, Auth, policies, functions or service_role.
-- Run only with a separate approval.

DO $$
DECLARE
  s record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.grant_cleanup_addendum_snapshot) THEN
    RAISE EXCEPTION 'no addendum snapshot found; refusing to roll back';
  END IF;

  -- Remove the column-level INSERT grants the addendum added.
  REVOKE INSERT (id, full_name, role, department, avatar_url, created_at, updated_at, is_active)
    ON public.profiles FROM authenticated;

  FOR s IN SELECT * FROM private.grant_cleanup_addendum_snapshot WHERE kind = 'relation' LOOP
    IF to_regclass(format('public.%I', s.object_name)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT %s ON TABLE public.%I TO %s%s',
        s.privilege,
        s.object_name,
        CASE WHEN s.grantee = 'PUBLIC' THEN 'PUBLIC' ELSE format('%I', s.grantee) END,
        CASE WHEN s.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
      );
    END IF;
  END LOOP;

  FOR s IN SELECT * FROM private.grant_cleanup_addendum_snapshot WHERE kind = 'default_table' LOOP
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT %s ON TABLES TO %s%s',
      s.privilege,
      CASE WHEN s.grantee = 'PUBLIC' THEN 'PUBLIC' ELSE format('%I', s.grantee) END,
      CASE WHEN s.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
    );
  END LOOP;

  DROP TABLE private.grant_cleanup_addendum_snapshot;
END $$;
