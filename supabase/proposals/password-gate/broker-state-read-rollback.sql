-- Rollback for supabase/proposals/password-gate/broker-state-read.sql.
-- Safe to run only after login-broker has been redeployed without the RPC call. Otherwise every
-- sign-in returns 503 login_unavailable again.
DROP FUNCTION IF EXISTS public.password_gate_broker_state(uuid);
