-- Locally prepared. Review recipient/reopen semantics, seed coverage and cron
-- definitions before a separately approved rollout. Do not blanket db push.
-- One delivery per ticket, recipient and stage for the ticket's lifetime.
-- Deleting a notification, reassigning away/back, or reopening does not reset
-- that delivery. A newly assigned recipient can receive their own alert.
CREATE TABLE IF NOT EXISTS public.sla_notification_deliveries (
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('sla_at_risk', 'sla_breached')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id, stage)
);
ALTER TABLE public.sla_notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sla_notification_deliveries FROM PUBLIC, anon, authenticated;

-- Preserve knowledge from still-present historical notifications. Previously
-- deleted or cleaned notifications cannot be reconstructed from this table.
INSERT INTO public.sla_notification_deliveries(ticket_id, user_id, stage)
SELECT DISTINCT t.id, n.user_id, n.type
FROM public.notifications n
JOIN public.tickets t ON n.link = '/tickets/' || t.id
JOIN public.profiles p ON p.id = n.user_id
WHERE n.type IN ('sla_at_risk', 'sla_breached')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.notify_sla_at_risk()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  recipient uuid;
BEGIN
  FOR r IN
    SELECT t.id, t.title, t.created_by, t.assigned_to, public.sla_hours(t.priority) AS target_h
    FROM public.tickets t
    WHERE t.status NOT IN ('resolved', 'closed', 'on_hold')
      AND (EXTRACT(EPOCH FROM (now() - t.created_at)) - COALESCE(t.total_hold_seconds, 0)) / 3600 >= public.sla_hours(t.priority) * 0.75
      AND (EXTRACT(EPOCH FROM (now() - t.created_at)) - COALESCE(t.total_hold_seconds, 0)) / 3600 < public.sla_hours(t.priority)
    ORDER BY t.id
  LOOP
    FOR recipient IN SELECT DISTINCT p.id FROM public.profiles p WHERE p.id IN (r.created_by, r.assigned_to) ORDER BY p.id
    LOOP
      INSERT INTO public.sla_notification_deliveries(ticket_id, user_id, stage)
      VALUES (r.id, recipient, 'sla_at_risk') ON CONFLICT DO NOTHING;
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
    SELECT t.id, t.title, t.created_by, t.assigned_to, public.sla_hours(t.priority) AS target_h,
      ROUND(((EXTRACT(EPOCH FROM (now() - t.created_at)) - COALESCE(t.total_hold_seconds, 0)) / 3600 - public.sla_hours(t.priority))::numeric, 1) AS overdue_h
    FROM public.tickets t
    WHERE t.status NOT IN ('resolved', 'closed', 'on_hold')
      AND (EXTRACT(EPOCH FROM (now() - t.created_at)) - COALESCE(t.total_hold_seconds, 0)) / 3600 > public.sla_hours(t.priority)
    ORDER BY t.id
  LOOP
    FOR recipient IN SELECT DISTINCT p.id FROM public.profiles p WHERE p.id IN (r.created_by, r.assigned_to) ORDER BY p.id
    LOOP
      INSERT INTO public.sla_notification_deliveries(ticket_id, user_id, stage)
      VALUES (r.id, recipient, 'sla_breached') ON CONFLICT DO NOTHING;
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
