-- Older clients attempt to log an unassignment after entering maintenance.
-- The database now preserves the assignee, so that event would be false.
CREATE OR REPLACE FUNCTION public.skip_false_maintenance_unassignment()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.action = 'unassigned' AND EXISTS (
    SELECT 1 FROM public.assets a WHERE a.id = NEW.asset_id
      AND a.status = 'maintenance' AND a.assigned_to IS NOT NULL
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER skip_false_maintenance_unassignment BEFORE INSERT ON public.asset_history
FOR EACH ROW EXECUTE FUNCTION public.skip_false_maintenance_unassignment();
