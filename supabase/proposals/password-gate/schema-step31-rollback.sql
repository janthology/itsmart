-- Rollback for supabase/proposals/password-gate/schema-step31.sql (Phase 3 step 3.1).
-- Removes only what 3.1 added. Refuses to run if restricted sessions or shadow-log
-- rows exist, because removing them would discard security or shadow evidence.
-- Run only with a separate approval.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.password_gate_admitted_sessions WHERE scope <> 'full') THEN
    RAISE EXCEPTION 'restricted sessions exist; review them before rolling back step 3.1';
  END IF;
  IF EXISTS (SELECT 1 FROM public.password_gate_shadow_log) THEN
    RAISE EXCEPTION 'shadow log has rows; export and clear them deliberately before rolling back step 3.1';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.password_gate_admit_restricted_session(uuid, uuid, uuid);
DROP TABLE IF EXISTS public.password_gate_shadow_log;
DROP TABLE IF EXISTS public.password_gate_settings;
ALTER TABLE public.password_gate_admitted_sessions
  DROP CONSTRAINT IF EXISTS password_gate_admitted_sessions_scope_check,
  DROP COLUMN IF EXISTS scope;
