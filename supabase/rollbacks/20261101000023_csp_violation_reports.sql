-- Reviewed rollback for locally prepared 00023 only. Stops new reports from
-- being stored by revoking the service-role insert grant, and drops the purge
-- function. It keeps the table, its collected reports, the read policy and the
-- index. Dropping the table would delete collected reports and needs a
-- separate retention decision. If a purge cron job was scheduled, unschedule
-- it first, or it will fail after the function is dropped.
REVOKE INSERT ON public.csp_violation_reports FROM service_role;
DROP FUNCTION IF EXISTS public.purge_csp_violation_reports();
