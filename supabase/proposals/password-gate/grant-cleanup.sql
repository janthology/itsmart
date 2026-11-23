-- Trusted password gate, Phase 3 step 3.0: grant cleanup.
-- APPLIED to production on 2026-11-23 as migration 20261123181414
-- password_gate_grant_cleanup, after the user approved it as written. The
-- migration text matches this file except for the header. Kept here as the
-- reviewed source. Rollback: grant-cleanup-rollback.sql (not yet run).
--
-- Why: live tables carry privileges the repository migrations never grant.
-- Supabase default privileges give anon, authenticated and service_role every
-- table privilege, including TRUNCATE, REFERENCES and TRIGGER. Row-level
-- security does not apply to those. The app never uses them through the Data API.
-- Verified read-only on 2026-11-23 (see docs/password-gate-phase3-review.md).
--
-- Changes, all for anon and authenticated only:
--   1. Revoke TRUNCATE, REFERENCES, TRIGGER on every table and view in public.
--   2. Revoke every privilege on admin_audit_log from anon.
--   3. Revoke INSERT, UPDATE, DELETE on profiles_with_email from authenticated
--      (the frontend only reads it; the view is not auto-updatable anyway).
--   4. Change the postgres default privileges for new public tables so the same
--      three privileges are not re-granted to anon or authenticated.
-- Not changed: service_role grants, RLS, policies, functions, column grants on
-- profiles, and the gate tables (which already have no anon/authenticated grants).
--
-- Snapshot: the first run stores the complete relation and default-table ACL in
-- private.grant_cleanup_snapshot before any change. The rollback restores from it.
-- Rollback file: supabase/proposals/password-gate/grant-cleanup-rollback.sql

-- 0. Snapshot (first run only). Runs before anything is revoked.
CREATE TABLE IF NOT EXISTS private.grant_cleanup_snapshot (
  captured_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('relation', 'column', 'default_table')),
  object_name text NOT NULL,
  column_name text,
  grantee text NOT NULL,
  privilege text NOT NULL,
  is_grantable boolean NOT NULL
);
REVOKE ALL ON private.grant_cleanup_snapshot FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.grant_cleanup_snapshot) THEN
    INSERT INTO private.grant_cleanup_snapshot (kind, object_name, column_name, grantee, privilege, is_grantable)
    SELECT 'relation', c.relname, NULL, COALESCE(g.rolname, 'PUBLIC'), a.privilege_type, a.is_grantable
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    LEFT JOIN pg_roles g ON g.oid = a.grantee
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f');

    INSERT INTO private.grant_cleanup_snapshot (kind, object_name, column_name, grantee, privilege, is_grantable)
    SELECT 'column', c.relname, attr.attname, COALESCE(g.rolname, 'PUBLIC'), a.privilege_type, a.is_grantable
    FROM pg_attribute attr
    JOIN pg_class c ON c.oid = attr.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    CROSS JOIN LATERAL aclexplode(attr.attacl) a
    LEFT JOIN pg_roles g ON g.oid = a.grantee
    WHERE attr.attnum > 0 AND attr.attacl IS NOT NULL
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f');

    INSERT INTO private.grant_cleanup_snapshot (kind, object_name, column_name, grantee, privilege, is_grantable)
    SELECT 'default_table', 'postgres', NULL, COALESCE(g.rolname, 'PUBLIC'), a.privilege_type, a.is_grantable
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace AND n.nspname = 'public'
    JOIN pg_roles r ON r.oid = d.defaclrole AND r.rolname = 'postgres'
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    LEFT JOIN pg_roles g ON g.oid = a.grantee
    WHERE d.defaclobjtype = 'r';
  END IF;
END $$;

-- 1-3. Existing objects. A table-level REVOKE of REFERENCES also removes any
-- column-level REFERENCES (checked in PGlite, 2026-11-23). TRIGGER has no column form.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON public.admin_audit_log FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.profiles_with_email FROM authenticated;

-- 4. Future objects created by the postgres role in public.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;

-- 5. Fail loudly if anything remains. A partial cleanup must not look successful.
DO $$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(c.relname || ':' || a.privilege_type || ':' || g.rolname, ', ')
  INTO leftover
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  JOIN pg_roles g ON g.oid = a.grantee
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND g.rolname IN ('anon', 'authenticated')
    AND (
      a.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
      OR (c.relname = 'admin_audit_log' AND g.rolname = 'anon')
      OR (c.relname = 'profiles_with_email' AND g.rolname = 'authenticated'
          AND a.privilege_type IN ('INSERT', 'UPDATE', 'DELETE'))
    );
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'grant cleanup incomplete: %', leftover;
  END IF;

  SELECT string_agg(c.relname || '.' || attr.attname || ':' || g.rolname, ', ')
  INTO leftover
  FROM pg_attribute attr
  JOIN pg_class c ON c.oid = attr.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  CROSS JOIN LATERAL aclexplode(attr.attacl) a
  JOIN pg_roles g ON g.oid = a.grantee
  WHERE attr.attnum > 0
    AND g.rolname IN ('anon', 'authenticated')
    AND a.privilege_type = 'REFERENCES';
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'grant cleanup incomplete (column REFERENCES): %', leftover;
  END IF;
END $$;
