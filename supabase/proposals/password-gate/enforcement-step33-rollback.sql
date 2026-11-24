-- Rollback for enforcement-step33.sql. PREPARED, NOT RUN. Requires separate approval.
-- Restores get_my_role and is_active_user from private.password_gate_step33_snapshot,
-- drops the restrictive scope policies and the three new helpers, then drops the snapshot.
-- Refuses to run without the snapshot. Safe after step 3.4: the settings row is not used
-- once the helpers are restored, and it stays in place for the Phase 3 record.

DO $$
BEGIN
  IF to_regclass('private.password_gate_step33_snapshot') IS NULL THEN
    RAISE EXCEPTION 'No step 3.3 snapshot; refusing to roll back';
  END IF;
  IF (SELECT count(*) FROM private.password_gate_step33_snapshot WHERE kind = 'function') <> 2 THEN
    RAISE EXCEPTION 'Snapshot must hold exactly two function definitions';
  END IF;
END $$;

-- 1. Drop the restrictive scope policies.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'password_gate_scope' LOOP
    EXECUTE format('DROP POLICY password_gate_scope ON public.%I', r.tablename);
  END LOOP;
END $$;

-- 2. Restore the two helpers exactly as captured.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT definition FROM private.password_gate_step33_snapshot WHERE kind = 'function' ORDER BY name LOOP
    EXECUTE r.definition;
  END LOOP;
END $$;

-- 3. Drop the new helpers.
DROP FUNCTION IF EXISTS public.password_gate_scope_ok();
DROP FUNCTION IF EXISTS public.password_gate_full_session();
DROP FUNCTION IF EXISTS public.password_gate_enforcement_mode();

-- 4. Verify, then drop the snapshot.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'password_gate_scope') THEN
    RAISE EXCEPTION 'Restrictive scope policies remain';
  END IF;
  IF pg_get_functiondef('public.get_my_role()'::regprocedure) LIKE '%password_gate%'
     OR pg_get_functiondef('public.is_active_user()'::regprocedure) LIKE '%password_gate%' THEN
    RAISE EXCEPTION 'Helpers still reference the gate';
  END IF;
END $$;

DROP TABLE private.password_gate_step33_snapshot;
