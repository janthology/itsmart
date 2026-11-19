-- Prepared locally; do not apply without reviewing live privileges, retention,
-- storage costs and rollback. This independent, append-only audit stream records
-- state changes even when older clients use direct table writes.
-- An existing object must be checked for exact schema/policy drift before
-- reapplication; IF NOT EXISTS is solely to retain records after rollback.
CREATE TABLE IF NOT EXISTS public.entity_change_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  entity_type text NOT NULL CHECK (entity_type IN ('ticket', 'asset', 'ticket_comment', 'asset_history', 'asset_maintenance')),
  entity_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  actor_id uuid,
  old_values jsonb,
  new_values jsonb,
  CHECK ((operation = 'INSERT' AND old_values IS NULL AND new_values IS NOT NULL)
      OR (operation = 'UPDATE' AND old_values IS NOT NULL AND new_values IS NOT NULL)
      OR (operation = 'DELETE' AND old_values IS NOT NULL AND new_values IS NULL))
);
CREATE INDEX IF NOT EXISTS entity_change_audit_entity_idx ON public.entity_change_audit (entity_type, entity_id, id DESC);
ALTER TABLE public.entity_change_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.entity_change_audit FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.entity_change_audit_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.entity_change_audit TO authenticated;
DROP POLICY IF EXISTS entity_change_audit_read_admin ON public.entity_change_audit;
CREATE POLICY entity_change_audit_read_admin ON public.entity_change_audit FOR SELECT TO authenticated
  USING (public.get_my_role() = 'administrator'::public.user_role);

-- Only the table owner can invoke this trigger function; the role on the
-- originating request cannot select an actor or write audit rows directly.
-- JSON is generated from OLD/NEW, not from client-supplied audit content.
CREATE OR REPLACE FUNCTION public.log_entity_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  previous jsonb;
  current_value jsonb;
  old_delta jsonb;
  new_delta jsonb;
  kind text := CASE TG_TABLE_NAME
    WHEN 'tickets' THEN 'ticket'
    WHEN 'assets' THEN 'asset'
    WHEN 'ticket_comments' THEN 'ticket_comment'
    WHEN 'asset_history' THEN 'asset_history'
    WHEN 'asset_maintenance_log' THEN 'asset_maintenance'
    ELSE NULL END;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR kind IS NULL THEN RAISE EXCEPTION 'Unexpected audit trigger source'; END IF;
  IF TG_OP <> 'INSERT' THEN previous := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN current_value := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT coalesce(jsonb_object_agg(k, previous -> k), '{}'::jsonb),
           coalesce(jsonb_object_agg(k, current_value -> k), '{}'::jsonb)
      INTO old_delta, new_delta
      FROM jsonb_object_keys(previous || current_value) AS keys(k)
      WHERE previous -> k IS DISTINCT FROM current_value -> k;
    IF old_delta = '{}'::jsonb THEN RETURN NEW; END IF;
  ELSE
    old_delta := previous;
    new_delta := current_value;
  END IF;
  INSERT INTO public.entity_change_audit(entity_type, entity_id, operation, actor_id, old_values, new_values)
    VALUES (kind, coalesce(NEW.id, OLD.id), TG_OP, auth.uid(), old_delta, new_delta);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.log_entity_change() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS audit_ticket_change ON public.tickets;
DROP TRIGGER IF EXISTS audit_asset_change ON public.assets;
DROP TRIGGER IF EXISTS audit_ticket_comment_change ON public.ticket_comments;
DROP TRIGGER IF EXISTS audit_asset_history_change ON public.asset_history;
DROP TRIGGER IF EXISTS audit_asset_maintenance_change ON public.asset_maintenance_log;
CREATE TRIGGER audit_ticket_change AFTER INSERT OR UPDATE OR DELETE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.log_entity_change();
CREATE TRIGGER audit_asset_change AFTER INSERT OR UPDATE OR DELETE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.log_entity_change();
CREATE TRIGGER audit_ticket_comment_change AFTER INSERT OR UPDATE OR DELETE ON public.ticket_comments
  FOR EACH ROW EXECUTE FUNCTION public.log_entity_change();
CREATE TRIGGER audit_asset_history_change AFTER INSERT OR UPDATE OR DELETE ON public.asset_history
  FOR EACH ROW EXECUTE FUNCTION public.log_entity_change();
CREATE TRIGGER audit_asset_maintenance_change AFTER INSERT OR UPDATE OR DELETE ON public.asset_maintenance_log
  FOR EACH ROW EXECUTE FUNCTION public.log_entity_change();
