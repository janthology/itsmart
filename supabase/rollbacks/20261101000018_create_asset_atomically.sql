-- Coordinate frontend rollback first: the new asset form requires this RPC.
-- Restores the legacy direct-write path, including its tag race and non-atomic
-- history. Existing created assets/history are not undone. Counters and request
-- ledger remain protected for review and possible reapplication. Approval and
-- drift checks are required before a production rollback.
DROP FUNCTION IF EXISTS public.create_asset_with_history(uuid,jsonb);
