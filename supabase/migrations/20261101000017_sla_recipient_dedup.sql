-- Prepared for review: one notification per ticket, cycle, recipient and stage.
-- Reopening a resolved/closed ticket starts a new cycle; reassignment within a
-- cycle does not reset it. SLA elapsed time itself is NOT reset by reopening.
-- Do not blanket-push against the differently versioned production history.
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS sla_alert_cycle bigint NOT NULL DEFAULT 0;

-- Maintain cycles even while the alert functions are rolled back. Ordinary
-- clients cannot choose an arbitrary cycle, on either INSERT or UPDATE.
CREATE OR REPLACE FUNCTION public.maintain_ticket_sla_alert_cycle()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.sla_alert_cycle := 0;
  ELSIF OLD.status IN ('resolved', 'closed') AND NEW.status NOT IN ('resolved', 'closed') THEN
    NEW.sla_alert_cycle := OLD.sla_alert_cycle + 1;
  ELSE
    NEW.sla_alert_cycle := OLD.sla_alert_cycle;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.maintain_ticket_sla_alert_cycle() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS maintain_ticket_sla_alert_cycle ON public.tickets;
CREATE TRIGGER maintain_ticket_sla_alert_cycle BEFORE INSERT OR UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.maintain_ticket_sla_alert_cycle();

-- Seed only on first installation. Re-seeding after rollback could attribute a
-- previous-cycle notification to a newer cycle and incorrectly suppress it.
DO $$
BEGIN
  IF to_regclass('public.sla_notification_deliveries') IS NULL THEN
    CREATE TABLE public.sla_notification_deliveries (
      ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      cycle bigint NOT NULL CHECK (cycle >= 0),
      stage text NOT NULL CHECK (stage IN ('sla_at_risk', 'sla_breached')),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (ticket_id, cycle, user_id, stage)
    );
    INSERT INTO public.sla_notification_deliveries(ticket_id, cycle, user_id, stage)
      SELECT DISTINCT t.id, t.sla_alert_cycle, n.user_id, n.type
      FROM public.notifications n
      JOIN public.tickets t ON n.link = '/tickets/' || t.id
      JOIN public.profiles p ON p.id = n.user_id
      WHERE n.type IN ('sla_at_risk', 'sla_breached')
      ON CONFLICT DO NOTHING;
  END IF;
END $$;
ALTER TABLE public.sla_notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sla_notification_deliveries FROM PUBLIC, anon, authenticated, service_role;

-- Lock eligible ticket rows in a consistent order until job commit so a
-- concurrent reopen cannot attach a delivery to an obsolete alert cycle.
-- This increases lock contention; jobs may deadlock or need another run.
CREATE OR REPLACE FUNCTION public.notify_sla_at_risk()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  recipient uuid;
BEGIN
  FOR r IN
    SELECT t.id, t.title, t.created_by, t.assigned_to, t.sla_alert_cycle, public.sla_hours(t.priority) AS target_h
    FROM public.tickets t
    WHERE t.status NOT IN ('resolved', 'closed', 'on_hold')
      AND (EXTRACT(EPOCH FROM (now() - t.created_at)) - COALESCE(t.total_hold_seconds, 0)) / 3600 >= public.sla_hours(t.priority) * 0.75
      AND (EXTRACT(EPOCH FROM (now() - t.created_at)) - COALESCE(t.total_hold_seconds, 0)) / 3600 < public.sla_hours(t.priority)
    ORDER BY t.id FOR UPDATE OF t
  LOOP
    FOR recipient IN SELECT DISTINCT p.id FROM public.profiles p WHERE p.id IN (r.created_by, r.assigned_to) ORDER BY p.id
    LOOP
      INSERT INTO public.sla_notification_deliveries(ticket_id, cycle, user_id, stage)
      VALUES (r.id, r.sla_alert_cycle, recipient, 'sla_at_risk') ON CONFLICT DO NOTHING;
      IF FOUND THEN
        INSERT INTO public.notifications(user_id, type, title, body, link)
        VALUES (recipient, 'sla_at_risk', '⚠️ SLA At Risk',
          'Ticket "' || r.title || '" is approaching its ' || r.target_h || 'h SLA deadline.',
          '/tickets/' || r.id);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_sla_breached()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  recipient uuid;
BEGIN
  FOR r IN
    SELECT t.id, t.title, t.created_by, t.assigned_to, t.sla_alert_cycle, public.sla_hours(t.priority) AS target_h,
      ROUND(((EXTRACT(EPOCH FROM (now() - t.created_at)) - COALESCE(t.total_hold_seconds, 0)) / 3600 - public.sla_hours(t.priority))::numeric, 1) AS overdue_h
    FROM public.tickets t
    WHERE t.status NOT IN ('resolved', 'closed', 'on_hold')
      AND (EXTRACT(EPOCH FROM (now() - t.created_at)) - COALESCE(t.total_hold_seconds, 0)) / 3600 > public.sla_hours(t.priority)
    ORDER BY t.id FOR UPDATE OF t
  LOOP
    FOR recipient IN SELECT DISTINCT p.id FROM public.profiles p WHERE p.id IN (r.created_by, r.assigned_to) ORDER BY p.id
    LOOP
      INSERT INTO public.sla_notification_deliveries(ticket_id, cycle, user_id, stage)
      VALUES (r.id, r.sla_alert_cycle, recipient, 'sla_breached') ON CONFLICT DO NOTHING;
      IF FOUND THEN
        INSERT INTO public.notifications(user_id, type, title, body, link)
        VALUES (recipient, 'sla_breached', '🚨 SLA Breached',
          'Ticket "' || r.title || '" has exceeded its ' || r.target_h || 'h SLA by ' || r.overdue_h || 'h.',
          '/tickets/' || r.id);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
