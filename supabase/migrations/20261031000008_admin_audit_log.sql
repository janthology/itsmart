-- Phase 5c: admin audit log (additive).
--
-- Records privileged admin actions (user created, role changed,
-- account activated/deactivated, password reset, asset deleted, ...).
-- Logging is best-effort from the client: it must never block the
-- underlying admin flow, so the frontend fires and forgets.
--
-- Access: administrators only. INSERT requires the actor to be an
-- active administrator writing their own row (actor_id = auth.uid()).
-- No UPDATE/DELETE policies exist, so rows are append-only for
-- everyone except service_role/postgres.

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at
  ON public.admin_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor
  ON public.admin_audit_log (actor_id, created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_audit_select_admin ON public.admin_audit_log;
CREATE POLICY admin_audit_select_admin
  ON public.admin_audit_log
  FOR SELECT
  USING (public.get_my_role() = 'administrator'::public.user_role);

DROP POLICY IF EXISTS admin_audit_insert_admin ON public.admin_audit_log;
CREATE POLICY admin_audit_insert_admin
  ON public.admin_audit_log
  FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'administrator'::public.user_role
    AND actor_id = auth.uid()
  );
