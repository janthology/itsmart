-- Trusted password gate, Phase 3 step 3.1: schema only.
-- PREPARED, NOT APPLIED. Requires separate approval and the migration path.
-- Rollback: supabase/proposals/password-gate/schema-step31-rollback.sql
--
-- Adds, with no policy, helper or app change:
--   1. scope on password_gate_admitted_sessions: 'full' (existing rows and the
--      Phase 1 admit function, unchanged) or 'password_change_only' (flagged accounts).
--   2. password_gate_admit_restricted_session(user, session, generation): admits
--      a restricted session for an account in 'required' or 'changing' only.
--      Refuses 'resetting' (ambiguous, locked until recovery), 'cleared', and
--      inactive accounts. Service role only.
--   3. password_gate_settings: one row, mode 'shadow' or 'enforce' (decision D6).
--      Nothing reads it until step 3.3, so changing it has no effect yet.
--   4. password_gate_shadow_log: one row per would-be denial (step 3.3). No policy
--      reads it yet. Holds the user ID, object name and time only.
--
-- Existing admitted-session rows do not change: the column defaults to 'full'.
-- The Phase 1 admit function does not set scope, so it cannot upgrade a
-- restricted row. A restricted session that later meets a full admission for
-- the same session ID stays restricted, which fails closed.

-- 1. Scope on admitted sessions.
ALTER TABLE public.password_gate_admitted_sessions
  ADD COLUMN scope text NOT NULL DEFAULT 'full',
  ADD CONSTRAINT password_gate_admitted_sessions_scope_check
    CHECK (scope IN ('full', 'password_change_only'));

-- 2. Restricted admission. Same fail-closed rules as password_gate_admit_session,
--    with a different phase set and scope.
CREATE OR REPLACE FUNCTION public.password_gate_admit_restricted_session(p_user uuid, p_session uuid, p_generation uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE current_generation uuid; completed_at timestamptz;
BEGIN
  IF p_user IS NULL OR p_session IS NULL OR p_generation IS NULL THEN
    RAISE EXCEPTION 'Missing session admission parameters';
  END IF;
  SELECT g.operation_id, g.updated_at INTO current_generation, completed_at
    FROM public.password_gate_state g JOIN public.profiles p ON p.id = g.user_id
    WHERE g.user_id = p_user AND g.phase IN ('required', 'changing') AND p.is_active
    FOR UPDATE OF g;
  IF NOT FOUND OR current_generation IS DISTINCT FROM p_generation THEN
    RAISE EXCEPTION 'Password generation changed or access unavailable';
  END IF;
  -- Fail closed: a null created_at never admits a session.
  PERFORM 1 FROM auth.sessions s
    WHERE s.id = p_session AND s.user_id = p_user
      AND s.created_at IS NOT NULL AND s.created_at > completed_at
      AND (s.not_after IS NULL OR s.not_after > now())
    FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session unavailable'; END IF;
  -- Plain INSERT: a session ID that is already admitted raises, so a restricted
  -- admission can never overwrite an existing row.
  INSERT INTO public.password_gate_admitted_sessions (session_id, user_id, generation, scope)
    VALUES (p_session, p_user, p_generation, 'password_change_only');
END
$function$;

REVOKE ALL ON FUNCTION public.password_gate_admit_restricted_session(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.password_gate_admit_restricted_session(uuid, uuid, uuid) TO service_role;

-- 3. Enforcement switch (service-only; read by no policy yet).
CREATE TABLE public.password_gate_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode text NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow', 'enforce')),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.password_gate_settings (id, mode) VALUES (1, 'shadow') ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.password_gate_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_gate_settings FROM PUBLIC, anon, authenticated, service_role;

-- 4. Shadow log (service-only; written by step 3.3 only).
CREATE TABLE public.password_gate_shadow_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  object_name text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX password_gate_shadow_log_decided_idx ON public.password_gate_shadow_log (decided_at);
ALTER TABLE public.password_gate_shadow_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_gate_shadow_log FROM PUBLIC, anon, authenticated, service_role;
-- Default privileges give anon and authenticated USAGE and UPDATE on new sequences.
REVOKE ALL ON SEQUENCE public.password_gate_shadow_log_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- 5. Fail loudly if the expected end state is not reached.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.password_gate_settings) <> 1 THEN
    RAISE EXCEPTION 'password_gate_settings must hold exactly one row';
  END IF;
  IF has_function_privilege('authenticated', 'public.password_gate_admit_restricted_session(uuid, uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.password_gate_admit_restricted_session(uuid, uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'restricted admission must not be executable by anon or authenticated';
  END IF;
END $$;
