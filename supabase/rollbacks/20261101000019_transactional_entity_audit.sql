-- Reviewed production rollback requires separate approval. Stop recording new
-- changes but preserve audit rows, read policy, index and identity sequence.
-- Subsequent changes will have no entries while triggers are absent.
DROP TRIGGER IF EXISTS audit_ticket_change ON public.tickets;
DROP TRIGGER IF EXISTS audit_asset_change ON public.assets;
DROP TRIGGER IF EXISTS audit_ticket_comment_change ON public.ticket_comments;
DROP TRIGGER IF EXISTS audit_asset_history_change ON public.asset_history;
DROP TRIGGER IF EXISTS audit_asset_maintenance_change ON public.asset_maintenance_log;
DROP FUNCTION IF EXISTS public.log_entity_change();
