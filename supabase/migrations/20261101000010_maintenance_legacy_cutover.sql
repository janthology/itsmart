-- Transitional compatibility for the still-deployed pre-workflow frontend.
-- Remove this policy and the admin direct-date allowance after the new frontend
-- is promoted to production. New clients always use the atomic RPCs.
CREATE POLICY maintenance_log_insert_legacy_admin
ON public.asset_maintenance_log FOR INSERT TO authenticated
WITH CHECK (
  public.get_my_role() = 'administrator'::public.user_role
  AND created_by = (SELECT auth.uid())
  AND maintenance_type IS NULL AND request_id IS NULL
  AND performed_by IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = performed_by AND p.is_active AND p.role IN ('administrator', 'support_staff'))
  AND performed_at <= (now() AT TIME ZONE 'Asia/Manila')::date
  AND length(trim(coalesce(description, ''))) > 0
);

CREATE OR REPLACE FUNCTION public.validate_asset_pm_dates() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- An older administrator client combines entering maintenance and clearing the
  -- assignee. Preserve the assignment even during the deployment transition.
  IF TG_OP = 'UPDATE' AND NEW.status = 'maintenance' AND OLD.status <> 'maintenance' THEN
    NEW.assigned_to := OLD.assigned_to;
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'maintenance' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    RAISE EXCEPTION 'Return the asset to service before reassignment';
  END IF;
  -- The old administrator frontend must continue working until promotion.
  -- Support staff must use the audited schedule RPC.
  IF TG_OP = 'UPDATE' AND current_user = 'authenticated' AND public.get_my_role() IS DISTINCT FROM 'administrator'::public.user_role AND
     (NEW.last_pm_date IS DISTINCT FROM OLD.last_pm_date OR NEW.next_pm_date IS DISTINCT FROM OLD.next_pm_date OR NEW.pm_required IS DISTINCT FROM OLD.pm_required) THEN
    RAISE EXCEPTION 'Use the audited PM schedule action';
  END IF;
  IF TG_OP = 'UPDATE' AND public.get_my_role() = 'support_staff'
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    RAISE EXCEPTION 'Only administrators may change asset status or assignment';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.next_pm_date IS DISTINCT FROM OLD.next_pm_date OR NEW.pm_required IS DISTINCT FROM OLD.pm_required THEN
    IF NOT NEW.pm_required AND NEW.next_pm_date IS NOT NULL THEN RAISE EXCEPTION 'PM-exempt assets cannot have a scheduled date'; END IF;
    -- Existing clients can create unscheduled assets; the new UI requires a
    -- schedule or an explicit opt-out and the dashboard flags missing dates.
    IF TG_OP = 'UPDATE' AND NEW.pm_required AND NEW.next_pm_date IS NULL THEN RAISE EXCEPTION 'Set a next PM date or mark PM not required'; END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.last_pm_date IS DISTINCT FROM OLD.last_pm_date OR NEW.next_pm_date IS DISTINCT FROM OLD.next_pm_date THEN
    IF NEW.last_pm_date > (now() AT TIME ZONE 'Asia/Manila')::date THEN RAISE EXCEPTION 'Last PM cannot be in the future'; END IF;
    IF NEW.last_pm_date IS NOT NULL AND NEW.next_pm_date IS NOT NULL AND NEW.next_pm_date <= NEW.last_pm_date THEN RAISE EXCEPTION 'Next PM must be after Last PM'; END IF;
  END IF;
  RETURN NEW;
END $$;
