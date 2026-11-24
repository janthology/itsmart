-- Visibility scope for profiles, assets, asset history and maintenance log (decision, 2026-11-24).
--
-- Profiles: every active user sees their own profile. Administrators see all profiles.
--           Support staff and general users see only their own.
-- Assets:   administrators and support staff see all assets. General users see only the
--           assets assigned to them.
-- Asset history and maintenance log follow the asset they belong to (they are visible only
-- when the asset itself is visible to the same user).
-- Tickets:  unchanged. Every active user may view all tickets and comment threads
--           (migration 20261030000006_general_users_view_all_tickets.sql).
--
-- The password_gate_scope policies are RESTRICTIVE, so the gate still applies on top of these
-- permissive SELECT policies. Writes are unchanged.
-- Rollback: supabase/rollbacks/20261124060000_password_gate_visibility_scope.sql

DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;
CREATE POLICY profiles_select_scoped
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR (public.is_active_user() AND public.get_my_role() = 'administrator'::public.user_role)
  );

DROP POLICY IF EXISTS assets_select_authenticated ON public.assets;
CREATE POLICY assets_select_scoped
  ON public.assets FOR SELECT
  TO authenticated
  USING (
    public.is_active_user()
    AND (
      public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
      OR assigned_to = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS asset_history_select_authenticated ON public.asset_history;
CREATE POLICY asset_history_select_scoped
  ON public.asset_history FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assets a WHERE a.id = asset_history.asset_id));

DROP POLICY IF EXISTS maintenance_log_select_authenticated ON public.asset_maintenance_log;
CREATE POLICY maintenance_log_select_scoped
  ON public.asset_maintenance_log FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assets a WHERE a.id = asset_maintenance_log.asset_id));
