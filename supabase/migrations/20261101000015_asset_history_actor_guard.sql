-- Locally prepared only. Review live policy and compatibility before rollout.
-- The existing UI sends the current authenticated user's ID. Require that ID
-- for direct staff inserts; security-definer maintenance RPCs keep their
-- existing server-derived actor and service-role operations retain their bypass.
-- This does not make asset updates/history atomic or validate event contents.
ALTER POLICY asset_history_insert_staff ON public.asset_history
  WITH CHECK (
    public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
    AND changed_by = (SELECT auth.uid())
  );
