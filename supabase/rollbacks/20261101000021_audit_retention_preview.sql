-- Reviewed rollback for locally proposed 00021 only. Removes the reporting
-- function and its dedicated index; never deletes audit rows or changes RLS.
DROP FUNCTION IF EXISTS public.audit_retention_preview();
DROP INDEX IF EXISTS public.entity_change_audit_occurred_at_idx;
