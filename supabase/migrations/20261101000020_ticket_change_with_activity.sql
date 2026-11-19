-- Prepared locally only. This invoker function preserves the existing RLS and
-- ticket guards, and does not grant additional roles permission to edit tickets.
-- It is an opt-in path for coordinated frontend deployment; legacy direct
-- writers remain possible until separately reviewed and removed.
CREATE OR REPLACE FUNCTION public.update_ticket_with_activity(
  p_ticket_id uuid, p_expected_updated_at timestamptz, p_changes jsonb, p_remarks text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  actor uuid := auth.uid();
  before_row public.tickets%ROWTYPE;
  after_row public.tickets%ROWTYPE;
  next_status public.ticket_status;
  next_priority public.ticket_priority;
  next_assignee uuid;
  actor_name text;
  assignee_name text;
  comment_body text := '';
  trimmed_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
BEGIN
  IF actor IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Active session required'; END IF;
  IF p_ticket_id IS NULL OR p_expected_updated_at IS NULL OR p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object'
     OR p_changes = '{}'::jsonb OR p_changes - ARRAY['status','priority','assigned_to'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid ticket change';
  END IF;
  IF length(coalesce(trimmed_remarks, '')) > 1000 THEN RAISE EXCEPTION 'Remarks exceed the maximum length'; END IF;
  SELECT * INTO before_row FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found or not writable'; END IF;
  IF before_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Ticket changed; refresh and try again'; END IF;
  next_status := CASE WHEN p_changes ? 'status' THEN (p_changes->>'status')::public.ticket_status ELSE before_row.status END;
  next_priority := CASE WHEN p_changes ? 'priority' THEN (p_changes->>'priority')::public.ticket_priority ELSE before_row.priority END;
  next_assignee := CASE WHEN p_changes ? 'assigned_to' THEN nullif(p_changes->>'assigned_to','')::uuid ELSE before_row.assigned_to END;
  IF next_status IS NULL OR next_priority IS NULL THEN RAISE EXCEPTION 'Status and priority cannot be null'; END IF;
  IF next_status = 'closed'::public.ticket_status THEN next_assignee := before_row.assigned_to; END IF;
  IF next_status IS NOT DISTINCT FROM before_row.status AND next_priority IS NOT DISTINCT FROM before_row.priority
     AND next_assignee IS NOT DISTINCT FROM before_row.assigned_to THEN RAISE EXCEPTION 'No ticket change requested'; END IF;
  IF next_status IS DISTINCT FROM before_row.status AND next_status IN ('on_hold','resolved','closed') AND trimmed_remarks IS NULL THEN
    RAISE EXCEPTION 'Remarks are required for this status';
  END IF;

  UPDATE public.tickets t SET
    status = next_status,
    priority = next_priority,
    assigned_to = next_assignee,
    on_hold_at = CASE
      WHEN next_status IS NOT DISTINCT FROM before_row.status THEN before_row.on_hold_at
      WHEN next_status = 'on_hold' THEN CURRENT_TIMESTAMP
      WHEN before_row.status = 'on_hold' THEN NULL
      ELSE before_row.on_hold_at END,
    total_hold_seconds = CASE
      WHEN next_status IS DISTINCT FROM before_row.status AND before_row.status = 'on_hold' AND before_row.on_hold_at IS NOT NULL
      THEN least(2147483647::bigint, before_row.total_hold_seconds::bigint + greatest(0::bigint, floor(extract(epoch FROM (CURRENT_TIMESTAMP - before_row.on_hold_at)))::bigint))::integer
      ELSE before_row.total_hold_seconds END,
    resolved_at = CASE
      WHEN next_status IS NOT DISTINCT FROM before_row.status THEN before_row.resolved_at
      WHEN next_status = 'resolved' THEN CURRENT_TIMESTAMP
      WHEN next_status IN ('open','in_progress') THEN NULL
      ELSE before_row.resolved_at END,
    closed_at = CASE
      WHEN next_status IS NOT DISTINCT FROM before_row.status THEN before_row.closed_at
      WHEN next_status = 'closed' THEN CURRENT_TIMESTAMP
      ELSE NULL END
  WHERE t.id = p_ticket_id RETURNING * INTO after_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found or not writable'; END IF;

  SELECT coalesce(nullif(btrim(full_name), ''), 'Unknown') INTO actor_name FROM public.profiles WHERE id = actor;
  actor_name := coalesce(actor_name, 'Unknown');
  IF after_row.status IS DISTINCT FROM before_row.status THEN
    comment_body := '🔄 Status changed to "' || initcap(replace(after_row.status::text, '_', ' ')) || '" by ' || actor_name || '.';
    IF after_row.status = 'closed' THEN
      comment_body := comment_body || E'\n' || CASE WHEN before_row.resolved_at IS NULL
        THEN '🏁 Closure path: Closed directly (no resolved stage). Assignee retained.'
        ELSE '🏁 Closure path: Resolved before closing. Assignee retained.' END;
    END IF;
  END IF;
  IF after_row.assigned_to IS DISTINCT FROM before_row.assigned_to THEN
    IF after_row.assigned_to IS NULL THEN
      comment_body := concat_ws(E'\n', nullif(comment_body,''), '🔓 Ticket unassigned by ' || actor_name || '.');
    ELSE
      SELECT coalesce(nullif(btrim(full_name),''),'Unknown') INTO assignee_name FROM public.profiles WHERE id=after_row.assigned_to;
      comment_body := concat_ws(E'\n', nullif(comment_body,''), '👤 Ticket assigned to ' || coalesce(assignee_name,'Unknown') || ' by ' || actor_name || '.');
    END IF;
  END IF;
  IF after_row.priority IS DISTINCT FROM before_row.priority THEN
    comment_body := concat_ws(E'\n', nullif(comment_body,''), 'Priority changed from "' || initcap(before_row.priority::text) || '" to "' || initcap(after_row.priority::text) || '" by ' || actor_name || '.');
  END IF;
  IF trimmed_remarks IS NOT NULL THEN comment_body := comment_body || E'\n\n' || '📝 Remarks: ' || trimmed_remarks; END IF;
  INSERT INTO public.ticket_comments(ticket_id,created_by,is_system,comment_text)
    VALUES (p_ticket_id,actor,false,comment_body);
  RETURN p_ticket_id;
END $$;
REVOKE ALL ON FUNCTION public.update_ticket_with_activity(uuid,timestamptz,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_ticket_with_activity(uuid,timestamptz,jsonb,text) TO authenticated;
