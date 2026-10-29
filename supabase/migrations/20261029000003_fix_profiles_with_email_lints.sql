-- =============================================================================
-- ITSMART (DOST Region 02 — IT Asset & Support Management)
-- Migration 03: Clear Supabase auth_users_exposed + security_definer_view lints
--
-- Replaces the auth.users-backed profiles_with_email view with:
--   1. A private (non-PostgREST-exposed) contact-details table, synced from
--      auth.users by trigger and protected by column-equivalent RLS scoping.
--   2. A security_invoker view over public.profiles + private contact data.
--
-- Result: the exposed view no longer references auth.users and no longer
-- runs with view-owner (security definer) privileges. Visibility semantics
-- are unchanged: admins/support see all emails + last sign-ins; general
-- users see only their own; anon sees nothing.
-- =============================================================================

-- 1. PRIVATE CONTACT STORE (schema not exposed via PostgREST)
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.profile_contact_details (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  email text,
  last_sign_in_at timestamptz
);

INSERT INTO private.profile_contact_details (id, email, last_sign_in_at)
SELECT p.id, u.email, u.last_sign_in_at
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email,
    last_sign_in_at = EXCLUDED.last_sign_in_at;

-- 2. SYNC TRIGGER (keeps private copy current on signup, email change, login)
CREATE OR REPLACE FUNCTION public.sync_profile_contact_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM private.profile_contact_details WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO private.profile_contact_details (id, email, last_sign_in_at)
  VALUES (NEW.id, NEW.email, NEW.last_sign_in_at)
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      last_sign_in_at = EXCLUDED.last_sign_in_at;

  RETURN NEW;
END;
$$;

-- Name sorts after on_auth_user_created so the profile row exists first.
DROP TRIGGER IF EXISTS zz_sync_profile_contact_from_auth ON auth.users;
CREATE TRIGGER zz_sync_profile_contact_from_auth
  AFTER INSERT OR UPDATE OF email, last_sign_in_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_contact_from_auth();

-- 3. RLS ON PRIVATE CONTACT STORE (mirrors the old view's CASE masking)
ALTER TABLE private.profile_contact_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_contact_select_scoped
  ON private.profile_contact_details;
CREATE POLICY profile_contact_select_scoped
  ON private.profile_contact_details FOR SELECT
  TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR (
      public.is_active_user()
      AND public.get_my_role() IN (
        'administrator'::public.user_role,
        'support_staff'::public.user_role
      )
    )
  );

REVOKE ALL ON SCHEMA private FROM anon, PUBLIC;
REVOKE ALL ON private.profile_contact_details FROM anon, PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
GRANT SELECT ON private.profile_contact_details TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON private.profile_contact_details TO service_role;

-- 4. REBUILD VIEW: invoker security, no auth.users reference
DROP VIEW IF EXISTS public.profiles_with_email;

CREATE VIEW public.profiles_with_email
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.full_name,
  p.role,
  p.department,
  p.is_active,
  p.must_change_password,
  p.password_changed_at,
  p.created_at,
  p.updated_at,
  c.email,
  c.last_sign_in_at
FROM public.profiles p
LEFT JOIN private.profile_contact_details c ON c.id = p.id;

REVOKE ALL ON public.profiles_with_email FROM anon, PUBLIC;
GRANT SELECT ON public.profiles_with_email TO authenticated, service_role;
