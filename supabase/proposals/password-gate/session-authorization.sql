-- RESEARCH ONLY: NOT A MIGRATION. Depends on operations.sql and authorization.sql.
-- A new session's timestamp alone does not prove it was authenticated with the
-- current password: a sign-in begun before reset could complete afterward.
-- This experiment binds application access to a session explicitly admitted by
-- a trusted login broker, under the same password-operation generation.
-- No broker, rollout, migration, cleanup, Auth verification, or recovery is
-- provided by this file. Do not apply to production.

CREATE TABLE public.password_session_authorization_prototype (
  session_id uuid PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.password_session_authorization_prototype ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_session_authorization_prototype FROM PUBLIC, anon, authenticated, service_role;

-- Service takes the snapshot BEFORE asking GoTrue to verify credentials. The
-- real broker must bind its lookup and GoTrue response to the same user and
-- derive the session ID from that verified response, never from the client.
CREATE FUNCTION public.prototype_snapshot_login_generation(p_user uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT g.operation_id FROM public.password_operation_prototype g
    JOIN public.profiles p ON p.id=g.user_id
    WHERE g.user_id=p_user AND g.phase='cleared' AND p.is_active
$$;

-- A broker can look up an active, uniquely matched Auth email before asking
-- GoTrue for a password session. It must return generic errors and implement
-- independent abuse/rate limiting; this lookup is service-only. Matching is
-- experimental and must be verified against the deployed Auth configuration.
CREATE FUNCTION public.prototype_snapshot_login_identity(p_email text)
RETURNS TABLE(user_id uuid, generation uuid, gate_phase text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT u.id, g.operation_id, g.phase FROM auth.users u
    JOIN public.profiles p ON p.id=u.id
    JOIN public.password_operation_prototype g ON g.user_id=u.id
    WHERE p_email IS NOT NULL AND length(p_email) BETWEEN 1 AND 320
      AND lower(u.email)=lower(trim(p_email)) AND p.is_active AND g.phase IN ('cleared','required')
      AND (SELECT count(*) FROM auth.users u2 WHERE lower(u2.email)=lower(trim(p_email)))=1
$$;

-- A trusted service may admit only a currently live session for the matching
-- user if the generation captured BEFORE credential verification is unchanged
-- and the session was created after the generation completed. The timestamp
-- alone is insufficient; only the trusted broker may choose the session.
-- The row lock serializes admission with begin/reset/change operations.
-- This function cannot prove verification; incorrect service use bypasses it.
CREATE FUNCTION public.prototype_admit_verified_session(p_user uuid, p_session uuid, p_generation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE current_generation uuid; completed_at timestamptz;
BEGIN
  IF p_user IS NULL OR p_session IS NULL OR p_generation IS NULL THEN RAISE EXCEPTION 'Missing session admission parameters'; END IF;
  SELECT g.operation_id, g.updated_at INTO current_generation, completed_at
    FROM public.password_operation_prototype g JOIN public.profiles p ON p.id=g.user_id
    WHERE g.user_id=p_user AND g.phase='cleared' AND p.is_active FOR UPDATE OF g;
  IF NOT FOUND OR current_generation IS DISTINCT FROM p_generation THEN
    RAISE EXCEPTION 'Password generation changed or access unavailable';
  END IF;
  PERFORM 1 FROM auth.sessions s WHERE s.id=p_session AND s.user_id=p_user
    AND s.created_at > completed_at AND (s.not_after IS NULL OR s.not_after > now()) FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session unavailable'; END IF;
  INSERT INTO public.password_session_authorization_prototype(session_id,user_id,operation_id)
    VALUES (p_session,p_user,p_generation)
    ON CONFLICT(session_id) DO UPDATE SET user_id=EXCLUDED.user_id, operation_id=EXCLUDED.operation_id, authorized_at=clock_timestamp();
END $$;

-- A verified temporary-password session may be returned only for the narrow
-- change-password flow; this does not admit it to business data. Validate the
-- same generation after verification and serialize with reset/change.
CREATE FUNCTION public.prototype_confirm_recovery_session(p_user uuid, p_session uuid, p_generation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE current_generation uuid; required_at timestamptz;
BEGIN
  IF p_user IS NULL OR p_session IS NULL OR p_generation IS NULL THEN RAISE EXCEPTION 'Missing recovery parameters'; END IF;
  SELECT g.operation_id, g.updated_at INTO current_generation, required_at
    FROM public.password_operation_prototype g JOIN public.profiles p ON p.id=g.user_id
    WHERE g.user_id=p_user AND g.phase='required' AND p.is_active FOR UPDATE OF g;
  IF NOT FOUND OR current_generation IS DISTINCT FROM p_generation THEN RAISE EXCEPTION 'Password generation changed or recovery unavailable'; END IF;
  PERFORM 1 FROM auth.sessions s WHERE s.id=p_session AND s.user_id=p_user
    AND s.created_at > required_at AND (s.not_after IS NULL OR s.not_after > now()) FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session unavailable'; END IF;
END $$;

CREATE FUNCTION public.prototype_admitted_session_access_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.password_operation_prototype g ON g.user_id=p.id
    JOIN public.password_session_authorization_prototype a ON a.user_id=p.id AND a.operation_id=g.operation_id
    JOIN auth.sessions s ON s.id=a.session_id AND s.user_id=p.id
    WHERE p.id=auth.uid() AND p.is_active AND g.phase='cleared'
      AND s.id=public.prototype_session_id() AND s.created_at > g.updated_at
      AND (s.not_after IS NULL OR s.not_after > now())
  )
$$;

REVOKE ALL ON FUNCTION public.prototype_snapshot_login_generation(uuid), public.prototype_snapshot_login_identity(text), public.prototype_admit_verified_session(uuid,uuid,uuid), public.prototype_confirm_recovery_session(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prototype_snapshot_login_generation(uuid), public.prototype_snapshot_login_identity(text), public.prototype_admit_verified_session(uuid,uuid,uuid), public.prototype_confirm_recovery_session(uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.prototype_admitted_session_access_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prototype_admitted_session_access_allowed() TO authenticated;
