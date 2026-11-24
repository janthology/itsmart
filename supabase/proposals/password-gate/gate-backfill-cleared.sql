-- Trusted password gate, step 3.2a (data): give existing accounts a cleared gate row.
-- PREPARED, NOT APPLIED. Requires separate approval. Not part of step 3.3.
-- Rollback: supabase/proposals/password-gate/gate-backfill-cleared-rollback.sql
--
-- Why: 14 of 15 profiles have no password_gate_state row (checked 2026-11-24, read-only).
-- The Phase 1 admit function only admits a session when the gate is 'cleared'. Without a
-- row, these accounts cannot be admitted through the broker, so enforcement would lock
-- them out. None of the 14 has must_change_password set, so 'cleared' is the correct state.
-- Each row gets a new generation (operation_id). Sessions created before this moment
-- are not admitted, which matches the forced sign-in at cutover (decision D3).

CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.gate_backfill_snapshot (
  user_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL,
  updated_at timestamptz NOT NULL
);
INSERT INTO private.gate_backfill_snapshot (user_id, operation_id, updated_at)
SELECT p.id, gen_random_uuid(), clock_timestamp()
  FROM public.profiles p
  WHERE NOT EXISTS (SELECT 1 FROM public.password_gate_state g WHERE g.user_id = p.id);

INSERT INTO public.password_gate_state (user_id, phase, operation_id, updated_at)
SELECT s.user_id, 'cleared', s.operation_id, s.updated_at
  FROM private.gate_backfill_snapshot s
  JOIN public.profiles p ON p.id = s.user_id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles p
             WHERE NOT EXISTS (SELECT 1 FROM public.password_gate_state g WHERE g.user_id = p.id)) THEN
    RAISE EXCEPTION 'Some profiles still have no gate row';
  END IF;
END $$;
