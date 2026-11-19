-- RESEARCH ONLY. Never apply to production. This intentionally changes two
-- foundational helpers used by RLS, triggers and SECURITY DEFINER functions.
-- Requires both password-gate research SQL files and a synthetic Auth schema.
-- It may break profile access, onboarding, cron/service calls and recovery;
-- it does not guard functions or Edge endpoints that don't use these helpers.
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT p.role FROM public.profiles p
  WHERE p.id=auth.uid() AND p.is_active AND public.prototype_password_access_allowed()
$$;
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT COALESCE((SELECT p.is_active FROM public.profiles p WHERE p.id=auth.uid()),false)
    AND public.prototype_password_access_allowed()
$$;
