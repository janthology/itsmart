-- Rollback reopens the previously documented authorization gaps.
-- Review and apply only as part of an approved incident rollback.
DROP TRIGGER IF EXISTS a_guard_ticket_insert ON public.tickets;
DROP FUNCTION IF EXISTS public.guard_ticket_insert();

CREATE OR REPLACE FUNCTION public.guard_ticket_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.user_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_role := public.get_my_role();

  IF v_role IN ('administrator'::public.user_role, 'support_staff'::public.user_role) THEN
    RETURN NEW;
  END IF;

  -- Must be active creator of the ticket
  IF v_role IS DISTINCT FROM 'general_user'::public.user_role OR OLD.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: insufficient permissions to update ticket';
  END IF;

  -- Immutable fields for general_user
  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     OR NEW.ticket_number IS DISTINCT FROM OLD.ticket_number THEN
    RAISE EXCEPTION 'Forbidden: general users cannot modify core ticket metadata';
  END IF;

  -- Status changes by general_user are only permitted from 'resolved' -> ('in_progress', 'closed')
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IS DISTINCT FROM 'resolved'::public.ticket_status
       OR NEW.status NOT IN ('in_progress'::public.ticket_status, 'closed'::public.ticket_status) THEN
      RAISE EXCEPTION 'Forbidden: general users may only reopen or close a resolved ticket';
    END IF;
  END IF;

  -- Satisfaction rating changes require ticket to be resolved or closed
  IF (NEW.satisfaction_rating IS DISTINCT FROM OLD.satisfaction_rating
      OR NEW.satisfaction_comment IS DISTINCT FROM OLD.satisfaction_comment)
     AND OLD.status NOT IN ('resolved'::public.ticket_status, 'closed'::public.ticket_status) THEN
    RAISE EXCEPTION 'Forbidden: satisfaction rating requires a resolved or closed ticket';
  END IF;

  RETURN NEW;
END;
$$;

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
