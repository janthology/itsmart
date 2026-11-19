-- RESEARCH PROTOTYPE ONLY: NOT A MIGRATION, NOT AN ACCESS CONTROL SYSTEM.
-- This isolates serialization/partial-failure state management for future
-- create/reset/change handlers. Do not deploy: no handler or RLS uses it.
CREATE TABLE public.password_operation_prototype (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  phase text NOT NULL CHECK (phase IN ('required','resetting','changing','cleared')),
  operation_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.password_operation_prototype ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_operation_prototype FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.prototype_begin_password_reset(p_user uuid, p_operation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE current_phase text; previous_operation uuid;
BEGIN
  IF p_user IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'User and operation required'; END IF;
  INSERT INTO public.password_operation_prototype(user_id,phase,operation_id)
    VALUES(p_user,'resetting',p_operation) ON CONFLICT(user_id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT phase, operation_id INTO current_phase, previous_operation FROM public.password_operation_prototype WHERE user_id=p_user FOR UPDATE;
    IF current_phase IN ('resetting','changing') THEN RAISE EXCEPTION 'Password operation already in progress'; END IF;
    IF previous_operation=p_operation THEN RAISE EXCEPTION 'Password operation ID reused'; END IF;
    UPDATE public.password_operation_prototype SET phase='resetting',operation_id=p_operation,updated_at=now() WHERE user_id=p_user;
  END IF;
  UPDATE public.profiles SET must_change_password=true WHERE id=p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
END $$;

CREATE FUNCTION public.prototype_finish_password_reset(p_user uuid, p_operation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  UPDATE public.password_operation_prototype SET phase='required',updated_at=now()
    WHERE user_id=p_user AND operation_id=p_operation AND phase IN ('resetting','required');
  IF NOT FOUND THEN RAISE EXCEPTION 'Password operation mismatch'; END IF;
END $$;

CREATE FUNCTION public.prototype_begin_password_change(p_user uuid, p_operation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_user IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'User and operation required'; END IF;
  UPDATE public.password_operation_prototype SET phase='changing',operation_id=p_operation,updated_at=now()
    WHERE user_id=p_user AND phase='required' AND operation_id <> p_operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'Password change not available'; END IF;
END $$;

-- Only call before attempting a password mutation. An ambiguous Auth outcome
-- must stay locked until a separately designed operator recovery process.
CREATE FUNCTION public.prototype_cancel_unattempted_change(p_user uuid, p_operation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  UPDATE public.password_operation_prototype SET phase='required',updated_at=now()
    WHERE user_id=p_user AND operation_id=p_operation AND phase='changing';
  IF NOT FOUND THEN RAISE EXCEPTION 'Password operation mismatch'; END IF;
END $$;

-- This trusts an authorized service to have verified a live session, the old
-- password and an actual, distinct new password update. SQL alone has no proof.
CREATE FUNCTION public.prototype_finish_password_change(p_user uuid, p_operation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE current_phase text;
BEGIN
  SELECT phase INTO current_phase FROM public.password_operation_prototype
    WHERE user_id=p_user AND operation_id=p_operation FOR UPDATE;
  IF NOT FOUND OR current_phase NOT IN ('changing','cleared') THEN RAISE EXCEPTION 'Password operation mismatch'; END IF;
  IF current_phase='changing' THEN
    UPDATE public.password_operation_prototype SET phase='cleared',updated_at=now() WHERE user_id=p_user;
    UPDATE public.profiles SET must_change_password=false,password_changed_at=now() WHERE id=p_user;
    IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.prototype_begin_password_reset(uuid,uuid), public.prototype_finish_password_reset(uuid,uuid),
  public.prototype_begin_password_change(uuid,uuid), public.prototype_cancel_unattempted_change(uuid,uuid),
  public.prototype_finish_password_change(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prototype_begin_password_reset(uuid,uuid), public.prototype_finish_password_reset(uuid,uuid),
  public.prototype_begin_password_change(uuid,uuid), public.prototype_cancel_unattempted_change(uuid,uuid),
  public.prototype_finish_password_change(uuid,uuid) TO service_role;
