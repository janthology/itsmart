-- Preserve legacy records: NULL maintenance_type means pre-workflow/unspecified.
ALTER TABLE public.asset_maintenance_log ADD COLUMN maintenance_type text;
ALTER TABLE public.asset_maintenance_log ADD COLUMN request_id uuid UNIQUE;
ALTER TABLE public.asset_maintenance_log ADD CONSTRAINT maintenance_type_valid
  CHECK (maintenance_type IS NULL OR maintenance_type IN ('preventive', 'corrective'));
ALTER TABLE public.assets ADD COLUMN pm_required boolean NOT NULL DEFAULT true;

-- All new records must go through the transaction below, which authenticates the actor.
DROP POLICY maintenance_log_insert_staff ON public.asset_maintenance_log;

CREATE OR REPLACE FUNCTION public.record_asset_maintenance(
  p_asset_id uuid, p_type text, p_performed_at date, p_performed_by uuid,
  p_description text, p_next_pm_date date, p_request_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.assets%ROWTYPE; v_id uuid; v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
BEGIN
  IF public.get_my_role() IS NULL OR public.get_my_role() NOT IN ('administrator', 'support_staff') THEN
    RAISE EXCEPTION 'Only active administrators and support staff may log maintenance';
  END IF;
  IF p_request_id IS NULL OR p_type IS NULL OR p_type NOT IN ('preventive', 'corrective') OR p_performed_at IS NULL OR p_performed_at > v_today OR p_performed_by IS NULL OR length(trim(coalesce(p_description, ''))) = 0 THEN
    RAISE EXCEPTION 'A valid type, non-future date, performer and description are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_performed_by AND is_active AND role IN ('administrator', 'support_staff')) THEN
    RAISE EXCEPTION 'Performer must be active staff';
  END IF;
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found'; END IF;
  SELECT id INTO v_id FROM public.asset_maintenance_log WHERE request_id = p_request_id;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.asset_maintenance_log WHERE id = v_id AND asset_id = p_asset_id AND created_by = auth.uid()) THEN RAISE EXCEPTION 'Request ID already used'; END IF;
    RETURN v_id;
  END IF;
  IF p_type = 'preventive' AND (a.last_pm_date IS NULL OR p_performed_at >= a.last_pm_date) THEN
    IF p_next_pm_date IS NULL OR p_next_pm_date <= p_performed_at THEN RAISE EXCEPTION 'Next PM must be after the performed date'; END IF;
  END IF;
  INSERT INTO public.asset_maintenance_log(asset_id, maintenance_type, performed_at, performed_by, description, created_by, request_id)
    VALUES (p_asset_id, p_type, p_performed_at, p_performed_by, trim(p_description), auth.uid(), p_request_id) RETURNING id INTO v_id;
  IF p_type = 'preventive' AND (a.last_pm_date IS NULL OR p_performed_at >= a.last_pm_date) THEN
    UPDATE public.assets SET last_pm_date = p_performed_at, next_pm_date = p_next_pm_date, pm_required = true, updated_at = now() WHERE id = p_asset_id;
    INSERT INTO public.asset_history(asset_id, action, field_name, old_value, new_value, changed_by) VALUES
      (p_asset_id, 'pm_recorded', 'Last PM Date', a.last_pm_date::text, p_performed_at::text, auth.uid()),
      (p_asset_id, 'pm_scheduled', 'Next PM Date', a.next_pm_date::text, p_next_pm_date::text, auth.uid());
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.record_asset_maintenance(uuid,text,date,uuid,text,date,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_asset_maintenance(uuid,text,date,uuid,text,date,uuid) TO authenticated;

-- A narrow, audited schedule update for staff; older invalid records are not rewritten.
CREATE OR REPLACE FUNCTION public.update_asset_pm_schedule(p_asset_id uuid, p_last date, p_next date, p_required boolean, p_expected_last date, p_expected_next date, p_expected_required boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.assets%ROWTYPE;
BEGIN
  IF public.get_my_role() IS NULL OR public.get_my_role() NOT IN ('administrator', 'support_staff') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_required IS NULL OR (p_required AND p_next IS NULL) OR (NOT p_required AND p_next IS NOT NULL) THEN RAISE EXCEPTION 'Provide a next date or mark PM not required'; END IF;
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found'; END IF;
  IF a.last_pm_date IS DISTINCT FROM p_expected_last OR a.next_pm_date IS DISTINCT FROM p_expected_next OR a.pm_required IS DISTINCT FROM p_expected_required THEN RAISE EXCEPTION 'PM schedule changed; refresh and try again'; END IF;
  IF p_last > (now() AT TIME ZONE 'Asia/Manila')::date THEN RAISE EXCEPTION 'Last PM cannot be in the future'; END IF;
  IF p_next IS NOT NULL AND p_last IS NOT NULL AND p_next <= p_last THEN RAISE EXCEPTION 'Next PM must be after Last PM'; END IF;
  UPDATE public.assets SET last_pm_date = p_last, next_pm_date = p_next, pm_required = p_required, updated_at = now() WHERE id = p_asset_id;
  IF a.last_pm_date IS DISTINCT FROM p_last THEN
    INSERT INTO public.asset_history(asset_id,action,field_name,old_value,new_value,changed_by) VALUES(p_asset_id,'field_updated','Last PM Date',a.last_pm_date::text,p_last::text,auth.uid());
  END IF;
  IF a.next_pm_date IS DISTINCT FROM p_next THEN
    INSERT INTO public.asset_history(asset_id,action,field_name,old_value,new_value,changed_by) VALUES(p_asset_id,'pm_scheduled','Next PM Date',a.next_pm_date::text,p_next::text,auth.uid());
  END IF;
  IF a.pm_required IS DISTINCT FROM p_required THEN
    INSERT INTO public.asset_history(asset_id,action,field_name,old_value,new_value,changed_by) VALUES(p_asset_id,'field_updated','PM Required',a.pm_required::text,p_required::text,auth.uid());
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.update_asset_pm_schedule(uuid,date,date,boolean,date,date,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_asset_pm_schedule(uuid,date,date,boolean,date,date,boolean) TO authenticated;

-- Correct descriptive details without silently rewriting history. Dates/types are
-- intentionally immutable; add a historical entry for a missing event instead.
CREATE OR REPLACE FUNCTION public.correct_asset_maintenance(p_log_id uuid, p_performed_by uuid, p_description text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE entry public.asset_maintenance_log%ROWTYPE;
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'administrator'::public.user_role THEN RAISE EXCEPTION 'Only administrators may correct a record'; END IF;
  IF p_performed_by IS NULL OR length(trim(coalesce(p_description, ''))) = 0 OR length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'Performer, description and correction reason are required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_performed_by AND is_active AND role IN ('administrator','support_staff')) THEN RAISE EXCEPTION 'Performer must be active staff'; END IF;
  SELECT * INTO entry FROM public.asset_maintenance_log WHERE id=p_log_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Record not found'; END IF;
  UPDATE public.asset_maintenance_log SET performed_by=p_performed_by, description=trim(p_description) WHERE id=p_log_id;
  INSERT INTO public.asset_history(asset_id,action,field_name,old_value,new_value,changed_by)
    VALUES(entry.asset_id,'maintenance_corrected','Maintenance record',
      jsonb_build_object('id',entry.id,'performer',entry.performed_by,'description',entry.description)::text,
      jsonb_build_object('id',entry.id,'performer',p_performed_by,'description',trim(p_description),'reason',trim(p_reason))::text,auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.correct_asset_maintenance(uuid,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_asset_maintenance(uuid,uuid,text,text) TO authenticated;

-- Date validation only when dates change, so legacy inconsistencies don't block unrelated edits.
CREATE OR REPLACE FUNCTION public.validate_asset_pm_dates() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
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
CREATE TRIGGER validate_asset_pm_dates BEFORE INSERT OR UPDATE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.validate_asset_pm_dates();

-- Durable deduplication survives users clearing their notifications and retention cleanup.
CREATE TABLE private.pm_notification_receipts (
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  stage text NOT NULL,
  PRIMARY KEY(asset_id,user_id,due_date,stage)
);
REVOKE ALL ON private.pm_notification_receipts FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.generate_pm_notifications() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
BEGIN
  WITH candidates AS (
    SELECT a.id AS asset_id, a.asset_tag, a.name, a.next_pm_date, p.id AS user_id,
      CASE WHEN a.next_pm_date < v_today THEN 'pm_overdue' WHEN a.next_pm_date = v_today THEN 'pm_due_today' ELSE 'pm_due_soon' END AS stage
    FROM public.assets a CROSS JOIN public.profiles p
    WHERE a.status <> 'retired' AND a.pm_required AND a.next_pm_date IS NOT NULL AND a.next_pm_date <= v_today + 7
      AND p.is_active AND p.role IN ('administrator', 'support_staff')
  ), inserted AS (
    INSERT INTO private.pm_notification_receipts(asset_id,user_id,due_date,stage)
    SELECT asset_id,user_id,next_pm_date,stage FROM candidates ON CONFLICT DO NOTHING
    RETURNING asset_id,user_id,due_date,stage
  )
  INSERT INTO public.notifications(user_id,type,title,body,link)
  SELECT c.user_id,c.stage,
    CASE c.stage WHEN 'pm_overdue' THEN 'PM Overdue: ' WHEN 'pm_due_today' THEN 'PM Due Today: ' ELSE 'PM Due Soon: ' END || c.name,
    'Preventive maintenance for ' || c.asset_tag || ' is due on ' || c.next_pm_date::text || '.', '/assets/' || c.asset_id::text
  FROM candidates c JOIN inserted i ON i.asset_id=c.asset_id AND i.user_id=c.user_id AND i.due_date=c.next_pm_date AND i.stage=c.stage;
END $$;
REVOKE ALL ON FUNCTION public.generate_pm_notifications() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('asset-pm-notifications', '15 * * * *', $$SELECT public.generate_pm_notifications()$$);
