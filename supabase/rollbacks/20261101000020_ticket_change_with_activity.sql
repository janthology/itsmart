-- Roll back the compatible frontend first, then remove this RPC only after
-- separately approved production rollback. Existing tickets, comments and
-- structured audit rows are retained; legacy writes are non-atomic.
DROP FUNCTION IF EXISTS public.update_ticket_with_activity(uuid,timestamptz,jsonb,text);
