-- The new maintenance frontend is in production. Close the temporary legacy
-- write path so all maintenance records and PM-date edits use audited RPCs.
DROP POLICY maintenance_log_insert_legacy_admin ON public.asset_maintenance_log;

CREATE OR REPLACE FUNCTION public.validate_asset_pm_dates() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Preserve the current assignee when entering maintenance and prohibit
  -- reassignment until the asset is returned to service.
  IF TG_OP = 'UPDATE' AND NEW.status = 'maintenance' AND OLD.status <> 'maintenance' THEN
    NEW.assigned_to := OLD.assigned_to;
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'maintenance' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    RAISE EXCEPTION 'Return the asset to service before reassignment';
  END IF;

  IF TG_OP = 'UPDATE' AND current_user = 'authenticated' AND
     (NEW.last_pm_date IS DISTINCT FROM OLD.last_pm_date OR NEW.next_pm_date IS DISTINCT FROM OLD.next_pm_date OR NEW.pm_required IS DISTINCT FROM OLD.pm_required) THEN
    RAISE EXCEPTION 'Use the audited PM schedule action';
  END IF;
  IF TG_OP = 'UPDATE' AND public.get_my_role() = 'support_staff'
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    RAISE EXCEPTION 'Only administrators may change asset status or assignment';
  END IF;
  -- Existing unscheduled assets are left intact until their schedule is edited.
  IF TG_OP = 'INSERT' OR NEW.next_pm_date IS DISTINCT FROM OLD.next_pm_date OR NEW.pm_required IS DISTINCT FROM OLD.pm_required THEN
    IF NOT NEW.pm_required AND NEW.next_pm_date IS NOT NULL THEN RAISE EXCEPTION 'PM-exempt assets cannot have a scheduled date'; END IF;
    IF NEW.pm_required AND NEW.next_pm_date IS NULL THEN RAISE EXCEPTION 'Set a next PM date or mark PM not required'; END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.last_pm_date IS DISTINCT FROM OLD.last_pm_date OR NEW.next_pm_date IS DISTINCT FROM OLD.next_pm_date THEN
    IF NEW.last_pm_date > (now() AT TIME ZONE 'Asia/Manila')::date THEN RAISE EXCEPTION 'Last PM cannot be in the future'; END IF;
    IF NEW.last_pm_date IS NOT NULL AND NEW.next_pm_date IS NOT NULL AND NEW.next_pm_date <= NEW.last_pm_date THEN RAISE EXCEPTION 'Next PM must be after Last PM'; END IF;
  END IF;
  RETURN NEW;
END $$;
