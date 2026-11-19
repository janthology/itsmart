-- ISOLATED RESEARCH ONLY. Not a production migration: this expects the
-- prototype operations schema and does not integrate real Edge Functions,
-- Realtime, security-definer business RPCs, onboarding, or recovery.
-- Do not apply to production. Absence of a trusted gate fails closed.
CREATE FUNCTION public.prototype_session_id() RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE claims jsonb; session_text text;
BEGIN
  claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  session_text := claims->>'session_id';
  IF session_text IS NULL OR session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  RETURN session_text::uuid;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END $$;
CREATE FUNCTION public.prototype_session_is_live() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id=public.prototype_session_id() AND s.user_id=auth.uid()
    AND (s.not_after IS NULL OR s.not_after > now()))
$$;

CREATE FUNCTION public.prototype_password_access_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT public.prototype_session_is_live() AND EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.password_operation_prototype g ON g.user_id=p.id
    JOIN auth.sessions s ON s.user_id=p.id
    WHERE p.id=auth.uid() AND p.is_active AND g.phase='cleared'
      AND s.id = public.prototype_session_id()
      AND s.created_at > g.updated_at
  )
$$;

CREATE FUNCTION public.prototype_password_gate_status() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT CASE
    WHEN NOT public.prototype_session_is_live() THEN 'invalid_session'
    WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active) THEN 'inactive'
    WHEN EXISTS (SELECT 1 FROM public.password_operation_prototype WHERE user_id=auth.uid() AND phase='cleared')
      AND NOT public.prototype_password_access_allowed() THEN 'reauthenticate'
    ELSE coalesce((SELECT phase FROM public.password_operation_prototype WHERE user_id=auth.uid()), 'uninitialized')
  END
$$;

-- Demonstrates that definer RPC authorization must depend on trusted state,
-- not only table RLS: every exposed definer function must be checked separately.
CREATE FUNCTION public.prototype_gated_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT p.role::text FROM public.profiles p
  WHERE p.id=auth.uid() AND p.is_active AND public.prototype_password_access_allowed()
$$;

REVOKE ALL ON FUNCTION public.prototype_session_id(), public.prototype_session_is_live(), public.prototype_password_access_allowed(),
  public.prototype_password_gate_status(), public.prototype_gated_role() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prototype_session_id(), public.prototype_session_is_live(), public.prototype_password_access_allowed(),
  public.prototype_password_gate_status(), public.prototype_gated_role() TO authenticated;

-- Defense in depth: gate authenticated requests even where permissive RLS
-- grants broad access. Service role and database owners retain their bypass.
DO $$
DECLARE item text;
BEGIN
  FOREACH item IN ARRAY ARRAY['categories','assets','asset_history','asset_maintenance_log','tickets','ticket_comments','notifications','admin_audit_log','entity_change_audit'] LOOP
    EXECUTE format('CREATE POLICY prototype_password_gate ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.prototype_password_access_allowed()) WITH CHECK (public.prototype_password_access_allowed())',item);
  END LOOP;
END $$;
CREATE POLICY prototype_password_gate ON private.profile_contact_details AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.prototype_password_access_allowed()) WITH CHECK (public.prototype_password_access_allowed());

-- A live-session user may read only their own profile while blocked, so the
-- UI can display recovery state; no profile mutation is allowed until cleared.
CREATE POLICY prototype_password_profile_read ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.prototype_session_is_live() AND (id=auth.uid() OR public.prototype_password_access_allowed()));
CREATE POLICY prototype_password_profile_insert ON public.profiles AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.prototype_password_access_allowed());
CREATE POLICY prototype_password_profile_update ON public.profiles AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.prototype_password_access_allowed()) WITH CHECK (public.prototype_password_access_allowed());
CREATE POLICY prototype_password_profile_delete ON public.profiles AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.prototype_password_access_allowed());

CREATE FUNCTION public.prototype_guard_password_flag() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF current_user='authenticated' AND (NEW.must_change_password IS DISTINCT FROM OLD.must_change_password
      OR NEW.password_changed_at IS DISTINCT FROM OLD.password_changed_at) THEN
    RAISE EXCEPTION 'Password status is server-managed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prototype_guard_password_flag BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prototype_guard_password_flag();
