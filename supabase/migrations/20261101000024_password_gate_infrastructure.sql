-- Trusted password gate, Phase 1: NON-ENFORCING infrastructure.
--
-- Adds service-only state for password operations and for admitted sessions,
-- and service-only functions that change that state. It changes no existing
-- table policy, grant, trigger, view or function, and no application code
-- calls it yet. It does NOT write profiles.must_change_password or
-- profiles.password_changed_at: those stay under the existing handlers until
-- Phase 2.
--
-- An account with no row in password_gate_state is simply not gated yet. This
-- migration does not initialize existing accounts, and nothing here treats an
-- unflagged account as trustworthy (that reconciliation is Phase 4).
--
-- Service-only: RLS is on with no policies, and no client role (PUBLIC, anon,
-- authenticated) has any table or function privilege. The functions are
-- SECURITY DEFINER with a fixed search_path. They are executable only by
-- service_role. The service must verify the caller and the Auth change itself;
-- SQL cannot prove a password was changed.

CREATE TABLE public.password_gate_state (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  phase text NOT NULL CHECK (phase IN ('required', 'resetting', 'changing', 'cleared')),
  operation_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- operation_id of the 'cleared' state is the generation that admitted sessions
-- must match.
CREATE TABLE public.password_gate_admitted_sessions (
  session_id uuid PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  generation uuid NOT NULL,
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX password_gate_admitted_sessions_user_idx ON public.password_gate_admitted_sessions (user_id);

ALTER TABLE public.password_gate_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_gate_admitted_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_gate_state FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.password_gate_admitted_sessions FROM PUBLIC, anon, authenticated, service_role;

-- Start a reset (administrator-initiated or self-initiated). Refused while
-- another reset or change is in progress. An ambiguous Auth outcome therefore
-- stays locked until a separately designed recovery runs.
CREATE FUNCTION public.password_gate_begin_reset(p_user uuid, p_operation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE current_phase text; current_operation uuid;
BEGIN
  IF p_user IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'User and operation required'; END IF;
  PERFORM 1 FROM public.profiles WHERE id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;

  INSERT INTO public.password_gate_state (user_id, phase, operation_id)
    VALUES (p_user, 'resetting', p_operation)
    ON CONFLICT (user_id) DO NOTHING;
  IF FOUND THEN RETURN; END IF;

  SELECT phase, operation_id INTO current_phase, current_operation
    FROM public.password_gate_state WHERE user_id = p_user FOR UPDATE;
  IF current_phase IN ('resetting', 'changing') THEN RAISE EXCEPTION 'Password operation already in progress'; END IF;
  IF current_operation = p_operation THEN RAISE EXCEPTION 'Password operation ID reused'; END IF;
  UPDATE public.password_gate_state
    SET phase = 'resetting', operation_id = p_operation, updated_at = clock_timestamp()
    WHERE user_id = p_user;
END $$;

-- Finish a reset after the Auth change succeeded. A repeated acknowledgement of
-- the same operation is accepted. A stale or different operation is rejected.
CREATE FUNCTION public.password_gate_finish_reset(p_user uuid, p_operation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_user IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'User and operation required'; END IF;
  UPDATE public.password_gate_state
    SET phase = 'required', updated_at = clock_timestamp()
    WHERE user_id = p_user AND operation_id = p_operation AND phase IN ('resetting', 'required');
  IF NOT FOUND THEN RAISE EXCEPTION 'Password operation mismatch'; END IF;
END $$;

-- Start a required password change by the signed-in user. Only from 'required',
-- with a new operation ID.
CREATE FUNCTION public.password_gate_begin_change(p_user uuid, p_operation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_user IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'User and operation required'; END IF;
  UPDATE public.password_gate_state
    SET phase = 'changing', operation_id = p_operation, updated_at = clock_timestamp()
    WHERE user_id = p_user AND phase = 'required' AND operation_id <> p_operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'Password change not available'; END IF;
END $$;

-- Only call this BEFORE a password mutation was sent to Auth. After an
-- ambiguous Auth response it is unsafe: the account must stay locked.
CREATE FUNCTION public.password_gate_cancel_unattempted_change(p_user uuid, p_operation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_user IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'User and operation required'; END IF;
  UPDATE public.password_gate_state
    SET phase = 'required', updated_at = clock_timestamp()
    WHERE user_id = p_user AND operation_id = p_operation AND phase = 'changing';
  IF NOT FOUND THEN RAISE EXCEPTION 'Password operation mismatch'; END IF;
END $$;

-- Mark a change complete. The caller must have verified the Auth change itself.
-- Repeating the completion of the same operation is accepted.
CREATE FUNCTION public.password_gate_finish_change(p_user uuid, p_operation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE current_phase text;
BEGIN
  IF p_user IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'User and operation required'; END IF;
  SELECT phase INTO current_phase FROM public.password_gate_state
    WHERE user_id = p_user AND operation_id = p_operation FOR UPDATE;
  IF NOT FOUND OR current_phase NOT IN ('changing', 'cleared') THEN
    RAISE EXCEPTION 'Password operation mismatch';
  END IF;
  IF current_phase = 'changing' THEN
    UPDATE public.password_gate_state SET phase = 'cleared', updated_at = clock_timestamp()
      WHERE user_id = p_user AND operation_id = p_operation;
  END IF;
END $$;

-- Admit a session the trusted broker has verified. The broker must take the
-- generation before it checks credentials, and must derive the session from
-- the Auth response, never from the client. This function checks that the
-- generation is still current, the account is active and the session is
-- live and was created after completion. It cannot prove verification itself.
-- Rows are removed when the Auth session is deleted.
CREATE FUNCTION public.password_gate_admit_session(p_user uuid, p_session uuid, p_generation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE current_generation uuid; completed_at timestamptz;
BEGIN
  IF p_user IS NULL OR p_session IS NULL OR p_generation IS NULL THEN RAISE EXCEPTION 'Missing session admission parameters'; END IF;
  SELECT g.operation_id, g.updated_at INTO current_generation, completed_at
    FROM public.password_gate_state g JOIN public.profiles p ON p.id = g.user_id
    WHERE g.user_id = p_user AND g.phase = 'cleared' AND p.is_active
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
  INSERT INTO public.password_gate_admitted_sessions (session_id, user_id, generation)
    VALUES (p_session, p_user, p_generation)
    ON CONFLICT (session_id) DO UPDATE
      SET user_id = EXCLUDED.user_id, generation = EXCLUDED.generation, admitted_at = clock_timestamp();
END $$;

REVOKE ALL ON FUNCTION public.password_gate_begin_reset(uuid, uuid),
  public.password_gate_finish_reset(uuid, uuid),
  public.password_gate_begin_change(uuid, uuid),
  public.password_gate_cancel_unattempted_change(uuid, uuid),
  public.password_gate_finish_change(uuid, uuid),
  public.password_gate_admit_session(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.password_gate_begin_reset(uuid, uuid),
  public.password_gate_finish_reset(uuid, uuid),
  public.password_gate_begin_change(uuid, uuid),
  public.password_gate_cancel_unattempted_change(uuid, uuid),
  public.password_gate_finish_change(uuid, uuid),
  public.password_gate_admit_session(uuid, uuid, uuid)
  TO service_role;
