-- Rollback for supabase/migrations/20261124041528_password_gate_recovery.sql.
-- Refuses while the recovery log has rows: those rows are the audit record of accounts already recovered.
-- A recovery is forward-only. Undo it per account with the normal admin reset, not by deleting log rows.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.password_gate_recovery_log) THEN
    RAISE EXCEPTION 'Recovery log has rows; rollback refused. Keep the audit record.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.password_gate_recover_account(uuid, text, uuid, uuid, text, text);
DROP TABLE IF EXISTS public.password_gate_recovery_log;
