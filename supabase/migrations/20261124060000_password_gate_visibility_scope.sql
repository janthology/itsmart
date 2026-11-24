-- Visibility scope for assets, asset history and maintenance log (decision, 2026-11-24).
--
-- Assets:   administrators and support staff see all assets. General users see only the
--           assets assigned to them.
-- Asset history and maintenance log follow the asset they belong to (visible only when the
-- asset itself is visible to the same user).
-- Profiles: unchanged. Every active user sees all profiles (names are needed for ticket
--           requesters, assignees, comment authors, asset holders and the support-staff list).
-- Tickets:  unchanged. Every active user may view all tickets (migration 20261030000006), and
--           support staff may update any ticket, including its assignee.
--
-- The password_gate_scope policies are RESTRICTIVE, so the gate still applies on top of these
-- permissive SELECT policies. Writes are unchanged.
-- Rollback: supabase/rollbacks/20261124060000_password_gate_visibility_scope.sql

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
