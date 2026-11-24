-- Rollback for gate-backfill-cleared.sql. PREPARED, NOT RUN. Requires separate approval.
-- Deletes only the rows this backfill created (same user and same operation_id, still
-- 'cleared'). Refuses to run without the snapshot. Rows changed since then are left alone.

DO $$
BEGIN
  IF to_regclass('private.gate_backfill_snapshot') IS NULL THEN
    RAISE EXCEPTION 'No backfill snapshot; refusing to roll back';
  END IF;
END $$;

DELETE FROM public.password_gate_state g
  USING private.gate_backfill_snapshot s
  WHERE g.user_id = s.user_id
    AND g.operation_id = s.operation_id
    AND g.phase = 'cleared';

DROP TABLE private.gate_backfill_snapshot;
