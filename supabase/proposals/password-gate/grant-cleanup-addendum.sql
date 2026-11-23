-- Trusted password gate, Phase 3 step 3.0 addendum: MAINTAIN and profile INSERT.
-- Approved by the user on 2026-11-23 ("MAINTAIN: revoke"; "column INSERT on the
-- flag columns: revoke"). APPLIED to production as migration 20261123182745.
-- Rollback: supabase/proposals/password-gate/grant-cleanup-addendum-rollback.sql
--
-- Why:
--   1. MAINTAIN (PostgreSQL 17+) lets a role run maintenance commands such as
--      VACUUM, ANALYZE, CLUSTER, REINDEX and REFRESH MATERIALIZED VIEW on a table.
--      It does not gate LOCK TABLE: a local test showed ACCESS EXCLUSIVE locks
--      still allowed through UPDATE and DELETE. The app never uses MAINTAIN. Live
--      tables grant it to authenticated, and the default privileges grant it to
--      anon, authenticated and service_role. Step 3.0 did not cover it.
--   2. Profile INSERT: authenticated has table-level INSERT on profiles, so it
--      can write must_change_password and password_changed_at on a new row. The
--      guard trigger covers UPDATE only. The fix is column-level INSERT on every
--      profile column except the two flags. The only client insert (register
--      upsert: id, full_name, department, role) is unaffected.
--
-- Not changed: service_role grants, the four column UPDATE grants from
-- migration 20261101000022, RLS, policies, functions, and the gate tables.

-- 0. Snapshot (first run only). Captured before any change.
CREATE TABLE IF NOT EXISTS private.grant_cleanup_addendum_snapshot (
  captured_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('relation', 'default_table')),
  object_name text NOT NULL,
  grantee text NOT NULL,
  privilege text NOT NULL,
  is_grantable boolean NOT NULL
);
REVOKE ALL ON private.grant_cleanup_addendum_snapshot FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.grant_cleanup_addendum_snapshot) THEN
    INSERT INTO private.grant_cleanup_addendum_snapshot (kind, object_name, grantee, privilege, is_grantable)
    SELECT 'relation', c.relname, COALESCE(g.rolname, 'PUBLIC'), a.privilege_type, a.is_grantable
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    LEFT JOIN pg_roles g ON g.oid = a.grantee
    WHERE c.relkind IN ('r', 'p')
      AND (a.privilege_type = 'MAINTAIN' OR (a.privilege_type = 'INSERT' AND c.relname = 'profiles'));

    INSERT INTO private.grant_cleanup_addendum_snapshot (kind, object_name, grantee, privilege, is_grantable)
    SELECT 'default_table', 'postgres', COALESCE(g.rolname, 'PUBLIC'), a.privilege_type, a.is_grantable
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace AND n.nspname = 'public'
    JOIN pg_roles r ON r.oid = d.defaclrole AND r.rolname = 'postgres'
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    LEFT JOIN pg_roles g ON g.oid = a.grantee
    WHERE d.defaclobjtype = 'r' AND a.privilege_type = 'MAINTAIN';
  END IF;
END $$;

-- 1. MAINTAIN on tables (not views, which do not take MAINTAIN), for anon and authenticated.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('REVOKE MAINTAIN ON TABLE public.%I FROM anon, authenticated', r.relname);
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE MAINTAIN ON TABLES FROM anon, authenticated;

-- 2. Profile INSERT: table-level INSERT replaced by a column list without the flags.
REVOKE INSERT ON public.profiles FROM authenticated;
GRANT INSERT (id, full_name, role, department, avatar_url, created_at, updated_at, is_active)
  ON public.profiles TO authenticated;

-- 3. Fail loudly if anything remains.
DO $$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(c.relname || ':' || g.rolname, ', ')
  INTO leftover
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  JOIN pg_roles g ON g.oid = a.grantee
  WHERE c.relkind IN ('r', 'p')
    AND g.rolname IN ('anon', 'authenticated')
    AND a.privilege_type = 'MAINTAIN';
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'MAINTAIN cleanup incomplete: %', leftover;
  END IF;

  IF has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'public.profiles', 'id', 'INSERT')
     OR has_column_privilege('authenticated', 'public.profiles', 'must_change_password', 'INSERT')
     OR has_column_privilege('authenticated', 'public.profiles', 'password_changed_at', 'INSERT') THEN
    RAISE EXCEPTION 'profile INSERT cleanup incomplete';
  END IF;
END $$;
