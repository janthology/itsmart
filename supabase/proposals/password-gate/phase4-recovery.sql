-- Trusted password gate, Phase 4: recovery of stranded accounts.
-- STATUS: DRAFTED, NOT APPLIED. Needs the owner's approval before production (one approval per apply).
-- Rollback: supabase/proposals/password-gate/phase4-recovery-rollback.sql
-- Runbook: docs/password-gate-phase4-recovery.md
--
-- What it does, for one account whose gate is stuck (resetting or changing), or which has no gate row:
--   1. Refuses unless the state is exactly the one the operator read (compare-and-set on phase and operation).
--      Only 'resetting' and 'changing' are recoverable. A flagged account with no gate row is already
--      recoverable by the normal admin reset (Phase 2 table), so it is not an input here.
--   2. Refuses within 15 minutes of the last gate change, so an operation that is still running is not
--      overwritten.
--   3. Moves the gate to 'required' under a NEW operation ID. Admitted sessions for the account are deleted,
--      so every existing session loses its admission and is denied once enforcement is on.
--   4. Sets profiles.must_change_password. A restricted sign-in then reaches /change-password only.
--   5. Writes one row to password_gate_recovery_log with the before-state, the actor and the reason.
--
-- It does NOT change any password, any Auth record, or any policy or grant. The one new table is the log. The operator then uses the
-- normal admin "Reset password" action for the account. That action is allowed from 'required', so it issues
-- a temporary password through the existing, reviewed path. No standing bypass is created.
--
-- Service-only: no client role can execute it or read the log. It is SECURITY DEFINER with a fixed search_path,
-- so it runs as its owner (postgres). It writes profiles.must_change_password as the owner, which the
-- guard in 20261101000022 allows: that guard only blocks authenticated and anon.

CREATE TABLE public.password_gate_recovery_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  from_phase text NOT NULL,
  from_operation uuid,
  to_operation uuid NOT NULL,
  actor text NOT NULL,
  reason text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.password_gate_recovery_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_gate_recovery_log FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.password_gate_recover_account(
  p_user uuid,
  p_expected_phase text,
  p_expected_operation uuid,
  p_new_operation uuid,
  p_actor text,
  p_reason text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cur_phase text;
  cur_operation uuid;
  cur_updated timestamptz;
BEGIN
  IF p_user IS NULL OR p_expected_phase IS NULL OR p_expected_operation IS NULL OR p_new_operation IS NULL
     OR p_actor IS NULL OR btrim(p_actor) = '' OR p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Recovery needs the user, the expected state, a new operation, an actor and a reason';
  END IF;
  IF p_expected_phase NOT IN ('resetting', 'changing') THEN
    RAISE EXCEPTION 'Recovery applies only to accounts in resetting or changing';
  END IF;
  IF p_new_operation = p_expected_operation THEN
    RAISE EXCEPTION 'Operation ID reused';
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;

  SELECT phase, operation_id, updated_at INTO cur_phase, cur_operation, cur_updated
    FROM public.password_gate_state WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND OR cur_phase <> p_expected_phase OR cur_operation <> p_expected_operation THEN
    RAISE EXCEPTION 'Expected state does not match';
  END IF;
  IF cur_updated > clock_timestamp() - interval '15 minutes' THEN
    RAISE EXCEPTION 'Gate changed within the last 15 minutes; wait for the quiet period';
  END IF;

  UPDATE public.password_gate_state
     SET phase = 'required', operation_id = p_new_operation, updated_at = clock_timestamp()
   WHERE user_id = p_user;
  DELETE FROM public.password_gate_admitted_sessions WHERE user_id = p_user;
  UPDATE public.profiles SET must_change_password = true WHERE id = p_user;

  INSERT INTO public.password_gate_recovery_log
    (user_id, from_phase, from_operation, to_operation, actor, reason)
    VALUES (p_user, cur_phase, cur_operation, p_new_operation, p_actor, p_reason);
END $$;

REVOKE ALL ON FUNCTION public.password_gate_recover_account(uuid, text, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.password_gate_recover_account(uuid, text, uuid, uuid, text, text) TO service_role;
