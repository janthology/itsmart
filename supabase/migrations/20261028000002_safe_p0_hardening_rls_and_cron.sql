-- =============================================================================
-- ITSMART (DOST Region 02 — IT Asset & Support Management)
-- Migration 02: Safe P0 Hardening, Triggers, Views, RLS Policies, Realtime & Cron
-- =============================================================================

-- =============================================================================
-- 1. SAFE P0 COLUMN-LEVEL GUARD FUNCTIONS
-- =============================================================================

-- Blocks non-administrators from escalating their own role or reactivating themselves
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow server/service_role/postgres administrative operations where auth.uid() is NULL
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Active administrators may update all profile fields
  IF public.get_my_role() = 'administrator'::public.user_role THEN
    RETURN NEW;
  END IF;

  -- Non-administrators may only update their own non-privileged profile fields
  IF OLD.id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: cannot update another user profile';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Forbidden: only administrators can change user roles';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Forbidden: only administrators can change account active status';
  END IF;

  RETURN NEW;
END;
$$;

-- Restricts general_user ticket updates to ONLY:
--   (a) submitting satisfaction_rating / satisfaction_comment on resolved/closed tickets, or
--   (b) confirming resolution ('closed') or reopening ('in_progress') their own resolved ticket
CREATE OR REPLACE FUNCTION public.guard_ticket_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.user_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_role := public.get_my_role();

  IF v_role IN ('administrator'::public.user_role, 'support_staff'::public.user_role) THEN
    RETURN NEW;
  END IF;

  -- Must be active creator of the ticket
  IF v_role IS DISTINCT FROM 'general_user'::public.user_role OR OLD.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: insufficient permissions to update ticket';
  END IF;

  -- Immutable fields for general_user
  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     OR NEW.ticket_number IS DISTINCT FROM OLD.ticket_number THEN
    RAISE EXCEPTION 'Forbidden: general users cannot modify core ticket metadata';
  END IF;

  -- Status changes by general_user are only permitted from 'resolved' -> ('in_progress', 'closed')
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IS DISTINCT FROM 'resolved'::public.ticket_status
       OR NEW.status NOT IN ('in_progress'::public.ticket_status, 'closed'::public.ticket_status) THEN
      RAISE EXCEPTION 'Forbidden: general users may only reopen or close a resolved ticket';
    END IF;
  END IF;

  -- Satisfaction rating changes require ticket to be resolved or closed
  IF (NEW.satisfaction_rating IS DISTINCT FROM OLD.satisfaction_rating
      OR NEW.satisfaction_comment IS DISTINCT FROM OLD.satisfaction_comment)
     AND OLD.status NOT IN ('resolved'::public.ticket_status, 'closed'::public.ticket_status) THEN
    RAISE EXCEPTION 'Forbidden: satisfaction rating requires a resolved or closed ticket';
  END IF;

  RETURN NEW;
END;
$$;

-- =============================================================================
-- 2. COMMENT LENGTH DOS GUARD (NOT VALID preserves historical QA rows; enforced on all new writes)
-- =============================================================================

DO $$ BEGIN
  ALTER TABLE public.ticket_comments
    ADD CONSTRAINT ticket_comments_comment_text_max_len
    CHECK (char_length(comment_text) <= 10000) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- 3. TRIGGERS (10 Original + 2 Safe P0 Column Guards)
-- =============================================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS trg_guard_profile_update ON public.profiles;
CREATE TRIGGER trg_guard_profile_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS on_profile_role_change ON public.profiles;
CREATE TRIGGER on_profile_role_change
  AFTER INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_role_to_auth();

DROP TRIGGER IF EXISTS update_assets_updated_at ON public.assets;
CREATE TRIGGER update_assets_updated_at
  BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_notify_asset_assigned ON public.assets;
CREATE TRIGGER trg_notify_asset_assigned
  AFTER INSERT OR UPDATE OF assigned_to ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.notify_asset_assigned();

DROP TRIGGER IF EXISTS set_ticket_number ON public.tickets;
CREATE TRIGGER set_ticket_number
  BEFORE INSERT ON public.tickets
  FOR EACH ROW WHEN (NEW.ticket_number IS NULL)
  EXECUTE FUNCTION public.generate_ticket_number();

DROP TRIGGER IF EXISTS trg_guard_ticket_update ON public.tickets;
CREATE TRIGGER trg_guard_ticket_update
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.guard_ticket_update();

DROP TRIGGER IF EXISTS update_tickets_updated_at ON public.tickets;
CREATE TRIGGER update_tickets_updated_at
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_notify_ticket_assigned ON public.tickets;
CREATE TRIGGER trg_notify_ticket_assigned
  AFTER INSERT OR UPDATE OF assigned_to ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_ticket_assigned();

DROP TRIGGER IF EXISTS trg_notify_ticket_update ON public.tickets;
CREATE TRIGGER trg_notify_ticket_update
  AFTER UPDATE OF status ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_ticket_update();

DROP TRIGGER IF EXISTS trg_notify_ticket_comment ON public.ticket_comments;
CREATE TRIGGER trg_notify_ticket_comment
  AFTER INSERT ON public.ticket_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_ticket_comment();

-- =============================================================================
-- 4. SECURE VIEW: profiles_with_email
--    - Zero anonymous access
--    - Administrators & Support Staff see email and last_sign_in_at
--    - General Users see directory names/departments, plus only their own email
-- =============================================================================

CREATE OR REPLACE VIEW public.profiles_with_email AS
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
  CASE
    WHEN public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
      OR p.id = (SELECT auth.uid())
    THEN u.email
    ELSE NULL
  END AS email,
  CASE
    WHEN public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
      OR p.id = (SELECT auth.uid())
    THEN u.last_sign_in_at
    ELSE NULL
  END AS last_sign_in_at
FROM public.profiles p
JOIN auth.users u ON u.id = p.id;

-- =============================================================================
-- 5. PRIVILEGE HARDENING (Revoke anon access across public tables & views)
-- =============================================================================

REVOKE ALL ON public.profiles FROM anon, PUBLIC;
REVOKE ALL ON public.categories FROM anon, PUBLIC;
REVOKE ALL ON public.assets FROM anon, PUBLIC;
REVOKE ALL ON public.asset_history FROM anon, PUBLIC;
REVOKE ALL ON public.asset_maintenance_log FROM anon, PUBLIC;
REVOKE ALL ON public.tickets FROM anon, PUBLIC;
REVOKE ALL ON public.ticket_comments FROM anon, PUBLIC;
REVOKE ALL ON public.notifications FROM anon, PUBLIC;
REVOKE ALL ON public.profiles_with_email FROM anon, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_history TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_maintenance_log TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_comments TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated, service_role;
GRANT SELECT ON public.profiles_with_email TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.notify_sla_at_risk() FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.notify_sla_breached() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_sla_at_risk() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.notify_sla_breached() TO postgres, service_role;

-- =============================================================================
-- 6. ROW LEVEL SECURITY POLICIES (Safe P0 Least-Privilege + InitPlan Optimized)
-- =============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_maintenance_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing policies for idempotency
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- 6.1 profiles
-- Authenticated users can read profiles (including own deactivated flag during login check)
CREATE POLICY profiles_select_authenticated
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.is_active_user() OR id = (SELECT auth.uid()));

CREATE POLICY profiles_insert_self
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    id = (SELECT auth.uid())
    AND role = 'general_user'::public.user_role
  );

CREATE POLICY profiles_update_self_or_admin
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    public.is_active_user()
    AND (
      id = (SELECT auth.uid())
      OR public.get_my_role() = 'administrator'::public.user_role
    )
  )
  WITH CHECK (
    public.is_active_user()
    AND (
      id = (SELECT auth.uid())
      OR public.get_my_role() = 'administrator'::public.user_role
    )
  );

-- 6.2 categories
CREATE POLICY categories_select_authenticated
  ON public.categories FOR SELECT
  TO authenticated
  USING (public.is_active_user());

CREATE POLICY categories_insert_staff
  ON public.categories FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
  );

CREATE POLICY categories_update_staff
  ON public.categories FOR UPDATE
  TO authenticated
  USING (
    public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
  )
  WITH CHECK (
    public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
  );

CREATE POLICY categories_delete_admin
  ON public.categories FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'administrator'::public.user_role);

-- 6.3 assets
CREATE POLICY assets_select_authenticated
  ON public.assets FOR SELECT
  TO authenticated
  USING (public.is_active_user());

CREATE POLICY assets_insert_staff
  ON public.assets FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
  );

CREATE POLICY assets_update_staff
  ON public.assets FOR UPDATE
  TO authenticated
  USING (
    public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
  )
  WITH CHECK (
    public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
  );

CREATE POLICY assets_delete_admin
  ON public.assets FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'administrator'::public.user_role);

-- 6.4 asset_history
CREATE POLICY asset_history_select_authenticated
  ON public.asset_history FOR SELECT
  TO authenticated
  USING (public.is_active_user());

CREATE POLICY asset_history_insert_staff
  ON public.asset_history FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
  );

CREATE POLICY asset_history_delete_admin
  ON public.asset_history FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'administrator'::public.user_role);

-- 6.5 asset_maintenance_log
CREATE POLICY maintenance_log_select_authenticated
  ON public.asset_maintenance_log FOR SELECT
  TO authenticated
  USING (public.is_active_user());

CREATE POLICY maintenance_log_insert_staff
  ON public.asset_maintenance_log FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
  );

CREATE POLICY maintenance_log_delete_admin
  ON public.asset_maintenance_log FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'administrator'::public.user_role);

-- 6.6 tickets
CREATE POLICY tickets_select_scoped
  ON public.tickets FOR SELECT
  TO authenticated
  USING (
    public.is_active_user()
    AND (
      public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
      OR created_by = (SELECT auth.uid())
      OR assigned_to = (SELECT auth.uid())
    )
  );

CREATE POLICY tickets_insert_authenticated
  ON public.tickets FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_user()
    AND (
      created_by = (SELECT auth.uid())
      OR public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
    )
  );

CREATE POLICY tickets_update_scoped
  ON public.tickets FOR UPDATE
  TO authenticated
  USING (
    public.is_active_user()
    AND (
      public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
      OR created_by = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    public.is_active_user()
    AND (
      public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
      OR created_by = (SELECT auth.uid())
    )
  );

CREATE POLICY tickets_delete_admin
  ON public.tickets FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'administrator'::public.user_role);

-- 6.7 ticket_comments
CREATE POLICY ticket_comments_select_scoped
  ON public.ticket_comments FOR SELECT
  TO authenticated
  USING (
    public.is_active_user()
    AND (
      public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
      OR EXISTS (
        SELECT 1 FROM public.tickets t
        WHERE t.id = ticket_comments.ticket_id
          AND (t.created_by = (SELECT auth.uid()) OR t.assigned_to = (SELECT auth.uid()))
      )
    )
  );

CREATE POLICY ticket_comments_insert_scoped
  ON public.ticket_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_user()
    AND created_by = (SELECT auth.uid())
    AND (
      public.get_my_role() IN ('administrator'::public.user_role, 'support_staff'::public.user_role)
      OR EXISTS (
        SELECT 1 FROM public.tickets t
        WHERE t.id = ticket_comments.ticket_id
          AND (t.created_by = (SELECT auth.uid()) OR t.assigned_to = (SELECT auth.uid()))
      )
    )
  );

CREATE POLICY ticket_comments_delete_admin
  ON public.ticket_comments FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'administrator'::public.user_role);

-- 6.8 notifications (Includes missing DELETE policy so frontend clearAll() works!)
CREATE POLICY notifications_select_own
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY notifications_insert_own
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_user()
    AND user_id = (SELECT auth.uid())
  );

CREATE POLICY notifications_update_own
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY notifications_delete_own
  ON public.notifications FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- =============================================================================
-- 7. SUPABASE REALTIME PUBLICATION
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
END $$;

-- =============================================================================
-- 8. PG_CRON SCHEDULED JOBS (SLA Alerts + Run-History Retention Cleanup)
-- =============================================================================

DO $$
DECLARE
  j RECORD;
BEGIN
  FOR j IN
    SELECT jobid FROM cron.job
    WHERE jobname IN ('sla-at-risk', 'sla-breached', 'cleanup-cron-job-run-details')
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'sla-at-risk',
  '*/30 * * * *',
  'SELECT public.notify_sla_at_risk()'
);

SELECT cron.schedule(
  'sla-breached',
  '*/15 * * * *',
  'SELECT public.notify_sla_breached()'
);

SELECT cron.schedule(
  'cleanup-cron-job-run-details',
  '0 3 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$$
);
