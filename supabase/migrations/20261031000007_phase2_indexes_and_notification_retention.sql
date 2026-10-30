-- Phase 2 (data-at-scale): server-side ticket search + pagination support
-- indexes, and retention cleanup for read notifications.
--
-- The tickets list now runs server-side search (title / ticket number
-- ilike) and paginates with (created_at DESC, id DESC) ordering; these
-- indexes keep both fast as the table grows. Notifications accumulate
-- forever today — read ones older than 90 days are deleted nightly.
-- Unread notifications are always kept.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Ordering used by every tickets list query (newest first, stable tiebreak).
CREATE INDEX IF NOT EXISTS idx_tickets_created_at_desc
  ON public.tickets (created_at DESC, id DESC);

-- Trigram indexes so ilike '%term%' searches on title / ticket number
-- stay index-assisted instead of sequential scans.
CREATE INDEX IF NOT EXISTS idx_tickets_title_trgm
  ON public.tickets USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tickets_ticket_number_trgm
  ON public.tickets USING gin (ticket_number gin_trgm_ops);

-- Retention cleanup: deletes read notifications older than the retention
-- window and returns how many rows were removed. Runs as the function
-- owner (postgres via pg_cron); not callable through the API.
CREATE OR REPLACE FUNCTION public.cleanup_old_notifications(p_retention_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.notifications
  WHERE is_read
    AND created_at < now() - make_interval(days => GREATEST(p_retention_days, 1));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_notifications(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_old_notifications(integer) FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_old_notifications(integer) FROM authenticated;

-- Daily at 03:15, staggered from the 03:00 cron-run-details cleanup.
SELECT cron.schedule(
  'cleanup-old-notifications',
  '15 3 * * *',
  $$SELECT public.cleanup_old_notifications(90)$$
);
