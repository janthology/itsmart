-- Prepared security stage; do not apply to production before the documented
-- migration/rollback review and a verified backup. This does not change rows.
-- Preserve existing frontend requests and the approved general-user actions.

-- Must run before set_ticket_number so a general user cannot supply a number
-- and bypass the server generator. Authenticated staff behavior is unchanged.
CREATE OR REPLACE FUNCTION public.guard_ticket_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.get_my_role() IS DISTINCT FROM 'general_user'::public.user_role THEN
    RETURN NEW;
  END IF;
  IF NEW.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the ticket creator can submit this ticket';
  END IF;
  IF NEW.status IS DISTINCT FROM 'open'::public.ticket_status
     OR NEW.assigned_to IS NOT NULL OR NEW.ticket_number IS NOT NULL
     OR NEW.resolved_at IS NOT NULL OR NEW.closed_at IS NOT NULL
     OR NEW.on_hold_at IS NOT NULL OR NEW.total_hold_seconds <> 0
     OR NEW.satisfaction_rating IS NOT NULL OR NEW.satisfaction_comment IS NOT NULL THEN
    RAISE EXCEPTION 'New tickets must be open and unassigned';
  END IF;
  -- Ignore untrusted client clocks for a new general-user ticket.
  NEW.created_at := CURRENT_TIMESTAMP;
  NEW.updated_at := CURRENT_TIMESTAMP;
  NEW.last_activity_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_guard_ticket_insert ON public.tickets;
CREATE TRIGGER a_guard_ticket_insert BEFORE INSERT ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.guard_ticket_insert();

CREATE OR REPLACE FUNCTION public.guard_ticket_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role public.user_role;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  v_role := public.get_my_role();
  -- Keep current staff permissions until the transactional transition path is
  -- implemented and its full role/compatibility matrix has been reviewed.
  IF v_role IN ('administrator'::public.user_role, 'support_staff'::public.user_role) THEN RETURN NEW; END IF;
  IF v_role IS DISTINCT FROM 'general_user'::public.user_role OR OLD.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: insufficient permissions to update ticket';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.priority IS DISTINCT FROM OLD.priority OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.ticket_number IS DISTINCT FROM OLD.ticket_number
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.on_hold_at IS DISTINCT FROM OLD.on_hold_at OR NEW.total_hold_seconds IS DISTINCT FROM OLD.total_hold_seconds THEN
    RAISE EXCEPTION 'Forbidden: general users cannot modify core ticket metadata or timing';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IS DISTINCT FROM 'resolved'::public.ticket_status
       OR NEW.status NOT IN ('in_progress'::public.ticket_status, 'closed'::public.ticket_status) THEN
      RAISE EXCEPTION 'Forbidden: general users may only reopen or close a resolved ticket';
    END IF;
    -- Ignore client-provided lifecycle timestamps for allowed transitions.
    IF NEW.status = 'closed'::public.ticket_status THEN
      NEW.resolved_at := OLD.resolved_at;
      NEW.closed_at := CURRENT_TIMESTAMP;
    ELSE
      NEW.resolved_at := NULL;
      NEW.closed_at := NULL;
    END IF;
  ELSIF NEW.resolved_at IS DISTINCT FROM OLD.resolved_at OR NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION 'Forbidden: lifecycle timestamps are server managed';
  END IF;
  IF (NEW.satisfaction_rating IS DISTINCT FROM OLD.satisfaction_rating
      OR NEW.satisfaction_comment IS DISTINCT FROM OLD.satisfaction_comment)
     AND OLD.status NOT IN ('resolved'::public.ticket_status, 'closed'::public.ticket_status) THEN
    RAISE EXCEPTION 'Forbidden: satisfaction rating requires a resolved or closed ticket';
  END IF;
  RETURN NEW;
END;
$$;

-- Existing support inserts were allowed; retain an unassigned, active insert
-- but do not allow initial status/assignment to bypass the UPDATE guard.
CREATE OR REPLACE FUNCTION public.validate_asset_pm_dates() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND public.get_my_role() = 'support_staff'
     AND (NEW.status <> 'active' OR NEW.assigned_to IS NOT NULL) THEN
    RAISE EXCEPTION 'Only administrators may set asset status or assignment';
  END IF;
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
