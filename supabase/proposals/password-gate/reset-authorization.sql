-- RESEARCH ONLY. Not a migration; depends on the session-admission prototype.
-- A trusted Edge handler must verify the bearer with GoTrue and derive both
-- actor ID and session ID from that token; these parameters are not trusted if
-- accepted directly from a browser. Service and database owners remain trusted.
-- Authorization is checked at operation start, not across the external Auth
-- request. Concurrent gate locks can deadlock (one transaction is aborted);
-- ambiguous outcomes must not be retried without review. Do not deploy.
CREATE FUNCTION public.prototype_begin_authorized_password_reset(
  p_user uuid, p_actor uuid, p_actor_session uuid, p_operation uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_user IS NULL OR p_actor IS NULL OR p_actor_session IS NULL OR p_operation IS NULL OR p_user=p_actor THEN
    RAISE EXCEPTION 'Reset unavailable';
  END IF;
  -- Lock the caller's gate while checking authority and acquiring the target
  -- operation. A reset that begins after this transaction commits is a later
  -- event; it cannot undo an already-started external Auth request.
  PERFORM 1 FROM public.password_operation_prototype g
    JOIN public.profiles p ON p.id=g.user_id
    JOIN public.password_session_authorization_prototype a ON a.user_id=p.id AND a.operation_id=g.operation_id
    JOIN auth.sessions s ON s.id=a.session_id AND s.user_id=p.id
    WHERE p.id=p_actor AND p.role::text='administrator' AND p.is_active AND g.phase='cleared'
      AND s.id=p_actor_session AND s.created_at>g.updated_at AND (s.not_after IS NULL OR s.not_after>now())
    FOR UPDATE OF g;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reset unavailable'; END IF;
  PERFORM public.prototype_begin_password_reset(p_user,p_operation);
END $$;
REVOKE ALL ON FUNCTION public.prototype_begin_authorized_password_reset(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prototype_begin_authorized_password_reset(uuid,uuid,uuid,uuid) TO service_role;
