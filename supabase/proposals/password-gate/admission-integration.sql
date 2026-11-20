-- RESEARCH ONLY: never apply to production. Load after operations.sql,
-- authorization.sql, session-authorization.sql and before role-helpers.sql.
-- This replaces only the prototype access predicate so its restrictive RLS
-- and experimental role helpers can exercise admission in synthetic tests.
-- It does NOT cover all exposed RPCs, Edge endpoints or service bypasses.
CREATE OR REPLACE FUNCTION public.prototype_password_access_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT public.prototype_admitted_session_access_allowed()
$$;
