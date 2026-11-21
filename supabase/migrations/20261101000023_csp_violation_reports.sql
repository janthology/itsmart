-- Prepared locally; NOT applied to production. Protected store for sanitized
-- Content-Security-Policy violation reports, written only by the csp-report
-- Edge Function (service role). No client role can read, insert, update or
-- delete rows except active administrators reading through RLS.
-- Query strings and fragments are removed by the function before storage.
CREATE TABLE IF NOT EXISTS public.csp_violation_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  document_uri text CHECK (char_length(document_uri) <= 500),
  blocked_uri text CHECK (char_length(blocked_uri) <= 500),
  violated_directive text CHECK (char_length(violated_directive) <= 200),
  effective_directive text CHECK (char_length(effective_directive) <= 200),
  source_file text CHECK (char_length(source_file) <= 500),
  line_number integer CHECK (line_number IS NULL OR line_number >= 0),
  disposition text CHECK (char_length(disposition) <= 20),
  user_agent text CHECK (char_length(user_agent) <= 300)
);
CREATE INDEX IF NOT EXISTS csp_violation_reports_received_at_idx ON public.csp_violation_reports (received_at);
ALTER TABLE public.csp_violation_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.csp_violation_reports FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.csp_violation_reports_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.csp_violation_reports TO authenticated;
GRANT INSERT ON public.csp_violation_reports TO service_role;
GRANT USAGE ON SEQUENCE public.csp_violation_reports_id_seq TO service_role;
DROP POLICY IF EXISTS csp_violation_reports_read_admin ON public.csp_violation_reports;
CREATE POLICY csp_violation_reports_read_admin ON public.csp_violation_reports FOR SELECT TO authenticated
  USING (public.get_my_role() = 'administrator'::public.user_role);

-- Retention: reports are deleted 90 days after receipt. The function is not
-- scheduled here; a cron job needs its own approval. It is owned by the
-- migration role and is not callable by any API role.
CREATE OR REPLACE FUNCTION public.purge_csp_violation_reports() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE deleted_count bigint;
BEGIN
  DELETE FROM public.csp_violation_reports WHERE received_at < clock_timestamp() - interval '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END $$;
REVOKE ALL ON FUNCTION public.purge_csp_violation_reports() FROM PUBLIC, anon, authenticated, service_role;
