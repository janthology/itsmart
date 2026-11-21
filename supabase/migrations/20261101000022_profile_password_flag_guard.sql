-- PREPARED, NOT APPLIED. Do not apply to production until the review, rollback
-- and the password-change Edge Function and frontend path are deployed. Applying
-- this before the change-password page uses that path would block mandatory
-- password changes for flagged accounts.
--
-- Purpose: stop signed-in users from writing their own mandatory-password flag
-- (must_change_password) or its timestamp (password_changed_at) through the
-- Data API. Service-role and SQL-editor writes (auth.uid() IS NULL) still work,
-- so Edge Functions and administrative repair are unaffected.
--
-- Known limit: this does not by itself prove a password was changed. Trusted
-- completion must come from a server-side change-password function.

-- 1. Remove table-level UPDATE, then grant only columns the client writes.
--    Client writers verified: users.ts (role, full_name, department, is_active),
--    register upsert (id, full_name, department, role).
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (role, full_name, department, is_active) ON public.profiles TO authenticated;

-- 2. Defence in depth: reject direct API writes to the flag columns even if
--    grants are later widened. Keyed on current_user, not auth.uid(), so that
--    SECURITY DEFINER server functions (owner role) keep working for the
--    approved completion path.
CREATE OR REPLACE FUNCTION public.guard_profile_password_flags()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.must_change_password IS DISTINCT FROM OLD.must_change_password
     OR NEW.password_changed_at IS DISTINCT FROM OLD.password_changed_at THEN
    RAISE EXCEPTION 'Forbidden: password-change flags can only be set by the server';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_password_flags ON public.profiles;
CREATE TRIGGER trg_guard_profile_password_flags
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_password_flags();
