-- =============================================================================
-- AUTO-CLOSE CLOSING REMARK / REASON
-- =============================================================================
-- Manual closing records a status-change remark in the ticket activity log.
-- Auto-closing now does the same: each auto-closed ticket gets a system
-- activity entry stating the reason for closing (7 days of inactivity after
-- resolution), including when the last activity occurred.
--
-- System entries have no human author, so ticket_comments.created_by becomes
-- nullable and is_system marks system-authored entries. Regular user comments
-- still require an author, and the insert policy rejects forged system rows.
-- =============================================================================

ALTER TABLE public.ticket_comments
  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.ticket_comments
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.ticket_comments
    ADD CONSTRAINT ticket_comments_system_author_check
    CHECK ((is_system AND created_by IS NULL) OR (NOT is_system AND created_by IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Regular users may only post as themselves and may not forge system entries.
DROP POLICY IF EXISTS ticket_comments_insert_scoped ON public.ticket_comments;
CREATE POLICY ticket_comments_insert_scoped
  ON public.ticket_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_user()
    AND is_system = false
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

-- System entries should not generate "new comment" notifications; the
-- status-change trigger already notifies the creator about the closure.
CREATE OR REPLACE FUNCTION public.notify_ticket_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
BEGIN
  IF NEW.is_system OR NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

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

-- Auto-close now also writes the closing remark, in the same format as a
-- manual close: status change line, closure path, then the reason.
CREATE OR REPLACE FUNCTION public.auto_close_resolved_tickets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closed integer;
BEGIN
  WITH eligible AS (
    SELECT
      t.id,
      GREATEST(
        COALESCE(t.last_activity_at, t.updated_at, t.resolved_at),
        COALESCE((SELECT MAX(c.created_at) FROM public.ticket_comments c WHERE c.ticket_id = t.id), t.resolved_at)
      ) AS last_activity_at
    FROM public.tickets t
    WHERE t.status = 'resolved'::public.ticket_status
      AND t.resolved_at IS NOT NULL
  ),
  closed AS (
    UPDATE public.tickets t
    SET status = 'closed'::public.ticket_status,
        closed_at = CURRENT_TIMESTAMP
    FROM eligible e
    WHERE t.id = e.id
      AND e.last_activity_at <= CURRENT_TIMESTAMP - interval '7 days'
    RETURNING t.id, e.last_activity_at
  ),
  logged AS (
    INSERT INTO public.ticket_comments (ticket_id, created_by, is_system, comment_text)
    SELECT
      c.id,
      NULL,
      true,
      '🔄 Status changed to "Closed" by System (auto-close).' || E'\n'
      || '🏁 Closure path: Resolved before closing. Assignee retained.' || E'\n\n'
      || '📝 Reason for closing: Automatically closed after 7 days of inactivity following resolution. '
      || 'Last activity was on '
      || to_char(c.last_activity_at AT TIME ZONE 'UTC', 'Mon DD, YYYY HH24:MI "UTC"')
      || '; no comments or ticket updates were recorded during the 7-day inactivity period.'
    FROM closed c
    RETURNING ticket_id
  )
  SELECT count(*) INTO v_closed FROM closed;

  RETURN v_closed;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_close_resolved_tickets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_close_resolved_tickets() TO service_role;
