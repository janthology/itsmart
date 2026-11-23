-- Rollback for supabase/proposals/password-gate/grant-cleanup.sql (step 3.0).
-- Ready for use. The apply step (migration 20261123181414) is live as of 2026-11-23.
-- Run this only with a separate approval, and only after checking the snapshot.
--
-- Restores every relation and default-table privilege recorded in
-- private.grant_cleanup_snapshot. Grants added after the apply are not removed.
-- Refuses to run if there is no snapshot, so it cannot guess the old state.
-- Does not touch rows, Auth users, sessions, policies, functions or service_role.
--
-- Check before running: the apply step must have run in this database, and
-- nothing else should have changed grants on the affected tables since.

DO $$
DECLARE
  s record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.grant_cleanup_snapshot) THEN
    RAISE EXCEPTION 'no grant snapshot found; refusing to roll back';
  END IF;

  FOR s IN SELECT * FROM private.grant_cleanup_snapshot WHERE kind = 'relation' LOOP
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

  FOR s IN SELECT * FROM private.grant_cleanup_snapshot WHERE kind = 'column' LOOP
    IF to_regclass(format('public.%I', s.object_name)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT %s (%I) ON TABLE public.%I TO %s%s',
        s.privilege,
        s.column_name,
        s.object_name,
        CASE WHEN s.grantee = 'PUBLIC' THEN 'PUBLIC' ELSE format('%I', s.grantee) END,
        CASE WHEN s.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
      );
    END IF;
  END LOOP;

  FOR s IN SELECT * FROM private.grant_cleanup_snapshot WHERE kind = 'default_table' LOOP
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT %s ON TABLES TO %s%s',
      s.privilege,
      CASE WHEN s.grantee = 'PUBLIC' THEN 'PUBLIC' ELSE format('%I', s.grantee) END,
      CASE WHEN s.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
    );
  END LOOP;

  DROP TABLE private.grant_cleanup_snapshot;
END $$;
