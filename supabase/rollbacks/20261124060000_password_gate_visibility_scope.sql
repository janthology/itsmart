-- Rollback for 20261124060000_password_gate_visibility_scope.sql.
-- Restores the previous permissive SELECT policies (all active users see all profiles, assets,
-- asset history and maintenance log). Run only if the visibility decision is withdrawn.

DROP POLICY IF EXISTS profiles_select_scoped ON public.profiles;
CREATE POLICY profiles_select_authenticated
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.is_active_user() OR id = (SELECT auth.uid()));

DROP POLICY IF EXISTS assets_select_scoped ON public.assets;
CREATE POLICY assets_select_authenticated
  ON public.assets FOR SELECT
  TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS asset_history_select_scoped ON public.asset_history;
CREATE POLICY asset_history_select_authenticated
  ON public.asset_history FOR SELECT
  TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS maintenance_log_select_scoped ON public.asset_maintenance_log;
CREATE POLICY maintenance_log_select_authenticated
  ON public.asset_maintenance_log FOR SELECT
  TO authenticated
  USING (public.is_active_user());
