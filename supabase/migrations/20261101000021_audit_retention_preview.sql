-- Prepared locally, not approved for production. Read-only reporting only:
-- no retention cleanup, deletion, scheduled job, export or legal-hold policy.
-- Depends on the separately reviewed entity_change_audit migration (00019).
CREATE INDEX IF NOT EXISTS entity_change_audit_occurred_at_idx ON public.entity_change_audit (occurred_at);

CREATE OR REPLACE FUNCTION public.audit_retention_preview()
RETURNS TABLE(as_of timestamptz, three_year_cutoff timestamptz, older_count bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_now timestamptz := CURRENT_TIMESTAMP;
DECLARE v_cutoff timestamptz := ((v_now AT TIME ZONE 'UTC') - interval '3 years') AT TIME ZONE 'UTC';
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'administrator'::public.user_role THEN
    RAISE EXCEPTION 'Only active administrators may review audit retention';
  END IF;
  RETURN QUERY SELECT v_now, v_cutoff, count(*) FROM public.entity_change_audit WHERE occurred_at < v_cutoff;
END $$;
REVOKE ALL ON FUNCTION public.audit_retention_preview() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.audit_retention_preview() TO authenticated;
