-- Reviewed rollback for locally prepared 00023 only. Stops new reports from
-- being stored by revoking the service-role insert grant. It keeps the table,
-- its collected reports, the read policy and the index. Dropping the table
-- would delete collected reports and needs a separate retention decision.
REVOKE INSERT ON public.csp_violation_reports FROM service_role;
