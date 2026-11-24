-- Trusted password gate, Phase 3 step 3.2 fix: service-only read of gate state for the broker.
-- STATUS: DRAFTED, NOT APPLIED. Needs the user's approval before production (one approval per apply).
-- Rollback: supabase/proposals/password-gate/broker-state-read-rollback.sql
--
-- Why: Phase 1 (migration 20261101000024) revoked every privilege on password_gate_state from
-- service_role, so only the gate functions touch it. login-broker read the table over REST, which
-- PostgREST refuses, so every sign-in returned 503 login_unavailable (found 2026-11-24).
--
-- This adds one read-only SECURITY DEFINER function that returns only phase and operation_id for one
-- user. It changes no state, no table grant and no policy. It is executable by service_role only.

CREATE FUNCTION public.password_gate_broker_state(p_user uuid)
RETURNS TABLE (phase text, operation_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT s.phase, s.operation_id
    FROM public.password_gate_state s
   WHERE s.user_id = p_user
$$;

REVOKE ALL ON FUNCTION public.password_gate_broker_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.password_gate_broker_state(uuid) TO service_role;
