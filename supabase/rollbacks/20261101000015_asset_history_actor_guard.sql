-- Restores the earlier policy and reopens spoofable asset-history authorship.
-- Apply only after explicit approval and verifying the live policy definition.
ALTER POLICY asset_history_insert_staff ON public.asset_history
  WITH CHECK (
    public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
  );
