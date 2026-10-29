-- =============================================================================
-- AUTO-CLOSE RESOLVED TICKETS AFTER 7 DAYS OF INACTIVITY
-- =============================================================================
-- A resolved ticket is automatically closed when there has been no activity
-- for 7 days. "Activity" is any ticket update (for example, changing the
-- status back to In Progress if the issue recurs) or any new comment.
--
-- Closing here is a status transition only: the assignee is retained and
-- resolved_at is kept, so the ticket is still tracked as resolved-before-
-- closed (as opposed to a ticket closed directly).
-- =============================================================================

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

-- Backfill from the best available historical signals.
UPDATE public.tickets t
SET last_activity_at = GREATEST(
  t.created_at,
  t.updated_at,
  COALESCE(t.resolved_at, t.created_at),
  COALESCE((SELECT MAX(c.created_at) FROM public.ticket_comments c WHERE c.ticket_id = t.id), t.created_at)
)
WHERE t.last_activity_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_status_last_activity
  ON public.tickets (status, last_activity_at);

-- Keep last_activity_at current on ticket inserts/updates. On UPDATE this
-- fires alongside the existing updated_at trigger; any ticket change counts
-- as activity and restarts the 7-day auto-close window.
CREATE OR REPLACE FUNCTION public.touch_ticket_last_activity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.last_activity_at IS NULL THEN
      NEW.last_activity_at := COALESCE(NEW.created_at, CURRENT_TIMESTAMP);
    END IF;
  ELSE
    NEW.last_activity_at := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_ticket_last_activity ON public.tickets;
CREATE TRIGGER trg_touch_ticket_last_activity
  BEFORE INSERT OR UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.touch_ticket_last_activity();

-- A new comment is activity on its ticket, even though it does not otherwise
-- update the ticket row. Touching the ticket also refreshes updated_at via
-- the existing trigger.
CREATE OR REPLACE FUNCTION public.touch_ticket_on_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tickets
  SET last_activity_at = NEW.created_at
  WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_ticket_on_comment ON public.ticket_comments;
CREATE TRIGGER trg_touch_ticket_on_comment
  AFTER INSERT ON public.ticket_comments
  FOR EACH ROW EXECUTE FUNCTION public.touch_ticket_on_comment();

-- Close every resolved ticket whose last activity is at least 7 days old.
-- Returns how many tickets were closed. The existing status-change trigger
-- notifies the ticket creator; assigned_to and resolved_at are untouched.
CREATE OR REPLACE FUNCTION public.auto_close_resolved_tickets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closed integer;
BEGIN
  UPDATE public.tickets t
  SET status = 'closed'::public.ticket_status,
      closed_at = CURRENT_TIMESTAMP
  WHERE t.status = 'resolved'::public.ticket_status
    AND t.resolved_at IS NOT NULL
    AND GREATEST(
          COALESCE(t.last_activity_at, t.updated_at, t.resolved_at),
          COALESCE((SELECT MAX(c.created_at) FROM public.ticket_comments c WHERE c.ticket_id = t.id), t.resolved_at)
        ) <= CURRENT_TIMESTAMP - interval '7 days';

  GET DIAGNOSTICS v_closed = ROW_COUNT;
  RETURN v_closed;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_close_resolved_tickets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_close_resolved_tickets() TO service_role;

-- Run hourly so eligible tickets close within an hour of the 7-day mark.
DO $$
DECLARE
  j RECORD;
BEGIN
  FOR j IN
    SELECT jobid FROM cron.job WHERE jobname = 'auto-close-resolved-tickets'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'auto-close-resolved-tickets',
  '0 * * * *',
  'SELECT public.auto_close_resolved_tickets()'
);
