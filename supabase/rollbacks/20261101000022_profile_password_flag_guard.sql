-- Rollback for 20261101000022. WARNING: restores signed-in users' ability to
-- write must_change_password and password_changed_at through the Data API.
-- Use only if the change-password path breaks and the flags must be unblocked.
DROP TRIGGER IF EXISTS trg_guard_profile_password_flags ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_profile_password_flags();
GRANT UPDATE ON public.profiles TO authenticated;
