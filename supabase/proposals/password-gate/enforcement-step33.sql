-- Trusted password gate, Phase 3 step 3.3: gate-aware helpers and restrictive scope policies.
-- PREPARED, NOT APPLIED. Requires separate approval and the migration path.
-- Rollback: supabase/proposals/password-gate/enforcement-step33-rollback.sql
-- Depends on: schema-step31.sql (applied 20261124012612) and grant-cleanup-addendum.sql (applied).
-- Shadow period: skipped by the user's decision on 2026-11-24. This step is still inert
-- on apply, because the settings row stays 'shadow'. Step 3.4 flips it to 'enforce'.
--
-- Behaviour with settings.mode = 'shadow' (the state after this step):
--   get_my_role() and is_active_user() return what they return today.
--   The restrictive policies allow everything. Nothing is denied by this step.
-- Behaviour with mode = 'enforce' (after step 3.4):
--   a business row is visible to or writable by an authenticated caller only in a
--   full-scope admitted session whose gate is 'cleared' and whose generation matches.
--   The one carve-out: any authenticated caller may read and write its own profile row,
--   so a restricted session can see must_change_password. The profile update policy
--   still requires an active, full-scope account, so restricted sessions cannot write.
-- Fail closed: a missing or invalid settings row counts as 'enforce'.
-- Service role, cron and SECURITY DEFINER functions run with auth.uid() NULL, and
-- the restrictive policies apply only to the authenticated role. They are not affected.

-- 0. Snapshot of the definitions this step replaces. The rollback restores from it.
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.password_gate_step33_snapshot (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL,
  name text NOT NULL,
  definition text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO private.password_gate_step33_snapshot (kind, name, definition)
SELECT 'function', p.proname, pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('get_my_role', 'is_active_user');
DO $$
BEGIN
  IF (SELECT count(*) FROM private.password_gate_step33_snapshot WHERE kind = 'function') <> 2 THEN
    RAISE EXCEPTION 'Snapshot must hold get_my_role and is_active_user';
  END IF;
END $$;

-- 1. Helpers. The mode is read from the service-only settings row.
CREATE OR REPLACE FUNCTION public.password_gate_enforcement_mode()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE((SELECT s.mode FROM public.password_gate_settings s WHERE s.id = 1), 'enforce');
$function$;

CREATE OR REPLACE FUNCTION public.password_gate_full_session()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.password_gate_admitted_sessions a
    JOIN public.password_gate_state g ON g.user_id = a.user_id
    WHERE a.session_id = NULLIF(auth.jwt() ->> 'session_id', '')::uuid
      AND a.user_id = auth.uid()
      AND a.scope = 'full'
      AND g.phase = 'cleared'
      AND g.operation_id = a.generation
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.password_gate_scope_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT public.password_gate_enforcement_mode() = 'shadow' OR public.password_gate_full_session();
$function$;

REVOKE ALL ON FUNCTION public.password_gate_enforcement_mode() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.password_gate_full_session() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.password_gate_scope_ok() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.password_gate_scope_ok() TO authenticated;

-- get_my_role and is_active_user keep their signatures and grants (CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid()
    AND is_active = true
    AND public.password_gate_scope_ok();
$function$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT is_active FROM public.profiles WHERE id = auth.uid() AND public.password_gate_scope_ok()),
    false
  );
$function$;

-- 2. Restrictive scope policies. They apply to every authenticated query on these
--    tables, whether or not the permissive policy uses a helper. The list is the set of
--    public tables that authenticated can read or write (checked below).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'admin_audit_log', 'asset_history', 'asset_maintenance_log', 'assets', 'categories',
    'csp_violation_reports', 'entity_change_audit', 'notifications', 'ticket_comments', 'tickets'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY password_gate_scope ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING (public.password_gate_scope_ok()) WITH CHECK (public.password_gate_scope_ok())', t);
  END LOOP;
  CREATE POLICY password_gate_scope ON public.profiles AS RESTRICTIVE FOR ALL TO authenticated
    USING (public.password_gate_scope_ok() OR id = (SELECT auth.uid()))
    WITH CHECK (public.password_gate_scope_ok() OR id = (SELECT auth.uid()));
END $$;

-- 3. Fail loudly if the expected end state is not reached, or if an RLS table that
--    authenticated can touch has no restrictive policy.
DO $$
DECLARE missing text;
BEGIN
  IF (SELECT count(*) FROM public.password_gate_settings) <> 1 THEN
    RAISE EXCEPTION 'password_gate_settings must hold exactly one row';
  END IF;
  IF (SELECT mode FROM public.password_gate_settings WHERE id = 1) <> 'shadow' THEN
    RAISE EXCEPTION 'Step 3.3 must leave the settings in shadow mode';
  END IF;
  IF has_function_privilege('anon', 'public.password_gate_scope_ok()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.password_gate_scope_ok()', 'EXECUTE') THEN
    RAISE EXCEPTION 'password_gate_scope_ok must be executable by authenticated only';
  END IF;
  IF pg_get_functiondef('public.get_my_role()'::regprocedure) NOT LIKE '%password_gate_scope_ok%'
     OR pg_get_functiondef('public.is_active_user()'::regprocedure) NOT LIKE '%password_gate_scope_ok%' THEN
    RAISE EXCEPTION 'Helpers do not reference the gate';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname = 'password_gate_scope'
        AND permissive = 'RESTRICTIVE') <> 11 THEN
    RAISE EXCEPTION 'Expected 11 restrictive scope policies';
  END IF;
  SELECT string_agg(c.relname, ', ') INTO missing
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
      AND has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      AND c.relname NOT IN ('admin_audit_log', 'asset_history', 'asset_maintenance_log', 'assets',
        'categories', 'csp_violation_reports', 'entity_change_audit', 'notifications',
        'ticket_comments', 'tickets', 'profiles');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Authenticated can reach tables without a scope policy: %', missing;
  END IF;
END $$;
