-- =============================================================================
-- ITSMART (DOST Region 02 — IT Asset & Support Management)
-- Migration 01: Core Extensions, Enums, Tables, Constraints, Indexes & Functions
-- Migrated from DOST2-ITASM (us-east-1) -> DOST02-ITSMART (ap-southeast-1)
-- =============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- =============================================================================
-- 1. ENUM TYPES
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE public.asset_category_type AS ENUM (
    'hardware',
    'software',
    'network',
    'mobile',
    'other',
    'laptop',
    'desktop',
    'monitor',
    'phone',
    'tablet',
    'printer',
    'server',
    'networking',
    'peripheral'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.asset_status AS ENUM (
    'active',
    'inactive',
    'maintenance',
    'retired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.category_type AS ENUM (
    'asset_category',
    'ticket_priority'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.ticket_priority AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.ticket_status AS ENUM (
    'open',
    'assigned',
    'in_progress',
    'resolved',
    'closed',
    'on_hold'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.ticket_type AS ENUM (
    'hardware_issue',
    'software_issue',
    'network_issue',
    'account_access',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM (
    'general_user',
    'support_staff',
    'administrator'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- 2. TABLES & CONSTRAINTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL,
  full_name text,
  role public.user_role NOT NULL DEFAULT 'general_user'::public.user_role,
  department text,
  avatar_url text,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  is_active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  password_changed_at timestamptz,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type public.category_type NOT NULL,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT categories_pkey PRIMARY KEY (id),
  CONSTRAINT categories_name_type_key UNIQUE (name, type)
);

CREATE TABLE IF NOT EXISTS public.assets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  asset_tag text NOT NULL,
  name text NOT NULL,
  category public.asset_category_type NOT NULL,
  status public.asset_status NOT NULL DEFAULT 'active'::public.asset_status,
  assigned_to uuid,
  purchase_date date,
  purchase_value numeric,
  notes text,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  serial_number text,
  location text,
  model text,
  last_pm_date date,
  next_pm_date date,
  CONSTRAINT assets_pkey PRIMARY KEY (id),
  CONSTRAINT assets_asset_tag_key UNIQUE (asset_tag),
  CONSTRAINT assets_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id)
);

CREATE TABLE IF NOT EXISTS public.asset_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL,
  action text NOT NULL,
  field_name text,
  old_value text,
  new_value text,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_history_pkey PRIMARY KEY (id),
  CONSTRAINT asset_history_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE,
  CONSTRAINT asset_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.asset_maintenance_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL,
  performed_by uuid,
  performed_at date NOT NULL,
  description text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_maintenance_log_pkey PRIMARY KEY (id),
  CONSTRAINT asset_maintenance_log_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE,
  CONSTRAINT asset_maintenance_log_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT asset_maintenance_log_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  status public.ticket_status NOT NULL DEFAULT 'open'::public.ticket_status,
  priority public.ticket_priority NOT NULL DEFAULT 'medium'::public.ticket_priority,
  asset_id uuid,
  created_by uuid NOT NULL,
  assigned_to uuid,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  closed_at timestamptz,
  ticket_number text,
  resolved_at timestamptz,
  type public.ticket_type DEFAULT 'other'::public.ticket_type,
  satisfaction_rating smallint,
  satisfaction_comment text,
  on_hold_at timestamptz,
  total_hold_seconds integer NOT NULL DEFAULT 0,
  CONSTRAINT tickets_pkey PRIMARY KEY (id),
  CONSTRAINT tickets_ticket_number_key UNIQUE (ticket_number),
  CONSTRAINT tickets_satisfaction_rating_check CHECK (satisfaction_rating >= 1 AND satisfaction_rating <= 5),
  CONSTRAINT tickets_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id),
  CONSTRAINT tickets_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id),
  CONSTRAINT tickets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);

CREATE TABLE IF NOT EXISTS public.ticket_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  created_by uuid NOT NULL,
  comment_text text NOT NULL,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ticket_comments_pkey PRIMARY KEY (id),
  CONSTRAINT ticket_comments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id),
  CONSTRAINT ticket_comments_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- =============================================================================
-- 3. INDEXES (Original + Foreign-Key Performance Indexes)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_assets_assigned_to ON public.assets USING btree (assigned_to);
CREATE INDEX IF NOT EXISTS idx_assets_status ON public.assets USING btree (status);

CREATE INDEX IF NOT EXISTS idx_asset_history_asset_id ON public.asset_history USING btree (asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_history_changed_by ON public.asset_history USING btree (changed_by);

CREATE INDEX IF NOT EXISTS idx_asset_maintenance_log_asset_id ON public.asset_maintenance_log USING btree (asset_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_maintenance_log_performed_by ON public.asset_maintenance_log USING btree (performed_by);
CREATE INDEX IF NOT EXISTS idx_asset_maintenance_log_created_by ON public.asset_maintenance_log USING btree (created_by);

CREATE INDEX IF NOT EXISTS idx_tickets_asset_id ON public.tickets USING btree (asset_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to ON public.tickets USING btree (assigned_to);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by ON public.tickets USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets USING btree (status);

CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket_id ON public.ticket_comments USING btree (ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_created_by ON public.ticket_comments USING btree (created_by);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON public.notifications USING btree (user_id, created_at DESC);

-- =============================================================================
-- 4. CORE & SECURITY HELPER FUNCTIONS (All with explicit search_path = public)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sla_hours(priority public.ticket_priority)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE priority::text
    WHEN 'critical' THEN 4
    WHEN 'high'     THEN 8
    WHEN 'medium'   THEN 24
    WHEN 'low'      THEN 72
    ELSE 24
  END;
$$;

-- Helper: returns caller's active role (NULL if unauthenticated or deactivated)
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid()
    AND is_active = true;
$$;

-- Helper: returns true only when caller has an active profile
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_active FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

-- SECURITY DEFINER so ticket sequence sees all rows even under scoped general_user RLS
-- Uses MAX(seq) + 1 instead of COUNT(*) + 1 to prevent collisions after ticket deletions
CREATE OR REPLACE FUNCTION public.generate_ticket_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_year TEXT;
  prefix       TEXT;
  seq_num      INT;
BEGIN
  current_year := TO_CHAR(NOW(), 'YYYY');
  prefix := 'DOST02-ITS' || current_year;

  SELECT COALESCE(
    MAX(
      NULLIF(
        regexp_replace(SUBSTRING(ticket_number FROM char_length(prefix) + 1), '[^0-9]', '', 'g'),
        ''
      )::INT
    ),
    0
  ) + 1
    INTO seq_num
    FROM public.tickets
   WHERE ticket_number LIKE prefix || '%';

  NEW.ticket_number := prefix || LPAD(seq_num::TEXT, 5, '0');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, department, role)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'department',
    'general_user'::public.user_role
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_role_to_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data =
    COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', NEW.role)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_asset_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL AND (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to) THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.assigned_to) THEN
      INSERT INTO public.notifications(user_id, type, title, body, link)
      VALUES (
        NEW.assigned_to,
        'asset_assigned',
        'Asset Assigned to You',
        'Asset ' || NEW.asset_tag || ' (' || NEW.name || ') has been assigned to you.',
        '/assets/' || NEW.id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_ticket_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL AND (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to) THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.assigned_to) THEN
      INSERT INTO public.notifications(user_id, type, title, body, link)
      VALUES (
        NEW.assigned_to,
        'ticket_assigned',
        'Ticket Assigned to You',
        'Ticket "' || NEW.title || '" has been assigned to you.',
        '/tickets/' || NEW.id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_ticket_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.created_by) THEN
      INSERT INTO public.notifications(user_id, type, title, body, link)
      VALUES (
        NEW.created_by,
        'ticket_update',
        'Ticket Status Updated',
        'Your ticket "' || NEW.title || '" status changed to ' || replace(NEW.status::text, '_', ' ') || '.',
        '/tickets/' || NEW.id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_ticket_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
BEGIN
  SELECT * INTO v_ticket FROM public.tickets WHERE id = NEW.ticket_id;

  IF v_ticket.created_by IS DISTINCT FROM NEW.created_by
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v_ticket.created_by) THEN
    INSERT INTO public.notifications(user_id, type, title, body, link)
    VALUES (
      v_ticket.created_by,
      'ticket_comment',
      'New Comment on Your Ticket',
      'A new comment was added to your ticket "' || v_ticket.title || '".',
      '/tickets/' || NEW.ticket_id
    );
  END IF;

  IF v_ticket.assigned_to IS NOT NULL
    AND v_ticket.assigned_to IS DISTINCT FROM NEW.created_by
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v_ticket.assigned_to) THEN
    INSERT INTO public.notifications(user_id, type, title, body, link)
    VALUES (
      v_ticket.assigned_to,
      'ticket_comment',
      'New Comment on Assigned Ticket',
      'A new comment was added to ticket "' || v_ticket.title || '".',
      '/tickets/' || NEW.ticket_id
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_sla_at_risk()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.id, t.title, t.priority, t.created_by, t.assigned_to,
           public.sla_hours(t.priority) AS target_h,
           (EXTRACT(EPOCH FROM (now() - t.created_at)) - COALESCE(t.total_hold_seconds, 0)) / 3600 AS active_elapsed_h
    FROM public.tickets t
    WHERE t.status NOT IN ('resolved', 'closed', 'on_hold')
      AND (EXTRACT(EPOCH FROM (now() - t.created_at)) - COALESCE(t.total_hold_seconds, 0)) / 3600
          >= public.sla_hours(t.priority) * 0.75
      AND (EXTRACT(EPOCH FROM (now() - t.created_at)) - COALESCE(t.total_hold_seconds, 0)) / 3600
          < public.sla_hours(t.priority)
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.link = '/tickets/' || t.id AND n.type = 'sla_at_risk'
      )
  LOOP
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = r.created_by) THEN
      INSERT INTO public.notifications(user_id, type, title, body, link)
      VALUES (r.created_by, 'sla_at_risk', '⚠️ SLA At Risk',
        'Ticket "' || r.title || '" is approaching its ' || r.target_h || 'h SLA deadline.',
        '/tickets/' || r.id);
    END IF;
    IF r.assigned_to IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = r.assigned_to) THEN
      INSERT INTO public.notifications(user_id, type, title, body, link)
      VALUES (r.assigned_to, 'sla_at_risk', '⚠️ SLA At Risk',
        'Ticket "' || r.title || '" is approaching its ' || r.target_h || 'h SLA deadline.',
        '/tickets/' || r.id);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_sla_breached()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.id, t.title, t.priority, t.created_by, t.assigned_to,
           public.sla_hours(t.priority) AS target_h,
           ROUND(((EXTRACT(EPOCH FROM (now() - t.created_at)) - COALESCE(t.total_hold_seconds, 0)) / 3600 - public.sla_hours(t.priority))::numeric, 1) AS overdue_h
    FROM public.tickets t
    WHERE t.status NOT IN ('resolved', 'closed', 'on_hold')
      AND (EXTRACT(EPOCH FROM (now() - t.created_at)) - COALESCE(t.total_hold_seconds, 0)) / 3600 > public.sla_hours(t.priority)
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.link = '/tickets/' || t.id AND n.type = 'sla_breached'
      )
  LOOP
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = r.created_by) THEN
      INSERT INTO public.notifications(user_id, type, title, body, link)
      VALUES (r.created_by, 'sla_breached', '🚨 SLA Breached',
        'Ticket "' || r.title || '" has exceeded its ' || r.target_h || 'h SLA by ' || r.overdue_h || 'h.',
        '/tickets/' || r.id);
    END IF;
    IF r.assigned_to IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = r.assigned_to) THEN
      INSERT INTO public.notifications(user_id, type, title, body, link)
      VALUES (r.assigned_to, 'sla_breached', '🚨 SLA Breached',
        'Ticket "' || r.title || '" has exceeded its ' || r.target_h || 'h SLA by ' || r.overdue_h || 'h.',
        '/tickets/' || r.id);
    END IF;
  END LOOP;
END;
$$;
