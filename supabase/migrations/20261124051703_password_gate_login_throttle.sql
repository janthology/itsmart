-- Trusted password gate, Phase 3 step 3.2: login throttle for the broker.
-- Per-account lockout. GoTrue has no lockout for the password grant, so the broker
-- counts wrong passwords here. Keys are SHA-256 hex of "login:" + the lowercased,
-- trimmed email, computed in the Edge Function. No email is stored.
--
-- Rules (constants below):
--   * 5 wrong passwords within 15 minutes lock the key for 15 minutes.
--   * A lock is checked BEFORE the password is sent to GoTrue, so a locked key is
--     refused even with the correct password.
--   * A successful password clears the key.
--   * After a lock has expired, the counter starts again.
--   * Unknown emails are counted the same way, so the response does not reveal
--     whether an account exists.
--
-- Service-only, like the rest of the gate: RLS on with no policies, no privilege for
-- PUBLIC, anon, authenticated or service_role on the table, and EXECUTE on the three
-- functions only for service_role. Rollback: supabase/rollbacks/20261124051703_password_gate_login_throttle.sql.

CREATE TABLE public.password_gate_login_throttle (
  throttle_key text PRIMARY KEY CHECK (throttle_key ~ '^[0-9a-f]{64}$'),
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  window_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.password_gate_login_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_gate_login_throttle FROM PUBLIC, anon, authenticated, service_role;

-- Seconds left on a lock, 0 when not locked.
CREATE FUNCTION public.password_gate_login_check(p_key text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE locked timestamptz;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid throttle key'; END IF;
  SELECT locked_until INTO locked FROM public.password_gate_login_throttle WHERE throttle_key = p_key;
  IF locked IS NULL OR locked <= clock_timestamp() THEN RETURN 0; END IF;
  RETURN ceil(extract(epoch FROM (locked - clock_timestamp())))::integer;
END $$;

-- Record one wrong password. Returns the seconds left on a lock after this failure, 0 when not locked.
CREATE FUNCTION public.password_gate_login_failed(p_key text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.password_gate_login_throttle%ROWTYPE; now_ts timestamptz := clock_timestamp();
BEGIN
  IF p_key IS NULL OR p_key !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid throttle key'; END IF;
  INSERT INTO public.password_gate_login_throttle (throttle_key, failures, window_started_at, updated_at)
    VALUES (p_key, 0, now_ts, now_ts) ON CONFLICT (throttle_key) DO NOTHING;
  SELECT * INTO r FROM public.password_gate_login_throttle WHERE throttle_key = p_key FOR UPDATE;
  -- A lock that has expired starts a fresh count.
  IF r.locked_until IS NOT NULL AND r.locked_until <= now_ts THEN
    r.failures := 0; r.window_started_at := now_ts; r.locked_until := NULL;
  END IF;
  IF r.window_started_at < now_ts - interval '15 minutes' THEN
    r.failures := 0; r.window_started_at := now_ts;
  END IF;
  r.failures := r.failures + 1;
  IF r.failures >= 5 THEN r.locked_until := now_ts + interval '15 minutes'; END IF;
  UPDATE public.password_gate_login_throttle
    SET failures = r.failures, window_started_at = r.window_started_at,
        locked_until = r.locked_until, updated_at = now_ts
    WHERE throttle_key = p_key;
  IF r.locked_until IS NOT NULL AND r.locked_until > now_ts THEN
    RETURN ceil(extract(epoch FROM (r.locked_until - now_ts)))::integer;
  END IF;
  RETURN 0;
END $$;

-- A correct password clears the key.
CREATE FUNCTION public.password_gate_login_succeeded(p_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_key IS NULL OR p_key !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid throttle key'; END IF;
  DELETE FROM public.password_gate_login_throttle WHERE throttle_key = p_key;
END $$;

REVOKE ALL ON FUNCTION public.password_gate_login_check(text), public.password_gate_login_failed(text),
  public.password_gate_login_succeeded(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.password_gate_login_check(text), public.password_gate_login_failed(text),
  public.password_gate_login_succeeded(text) TO service_role;
