-- Restores the earlier functions and their ticket-wide deduplication bugs.
-- The protected delivery ledger, ticket cycle column, and cycle-maintenance
-- trigger are retained; the old alert functions ignore them. The retained
-- trigger keeps tracking reopens while rolled back, but alerts sent by old
-- functions are not recorded in the ledger and may repeat after reapplication.
-- Apply only after explicit approval and live drift checks.

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
