-- Rollback for supabase/migrations/20261124051703_password_gate_login_throttle.sql.
-- Only safe after the broker that calls these functions is redeployed without the throttle.
-- Dropping the table removes every counter and lock.
DROP FUNCTION IF EXISTS public.password_gate_login_check(text);
DROP FUNCTION IF EXISTS public.password_gate_login_failed(text);
DROP FUNCTION IF EXISTS public.password_gate_login_succeeded(text);
DROP TABLE IF EXISTS public.password_gate_login_throttle;
