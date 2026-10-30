-- General users: read-only, organization-wide ticket visibility.
--
-- Previously tickets_select_scoped limited general users to tickets they
-- created or were assigned to, so the Tickets page "All tickets" view could
-- never actually show the organization-wide queue for them. Product decision:
-- every active authenticated user may VIEW all tickets and their comment
-- threads (e.g. to check whether an issue is already reported).
--
-- This widens SELECT only. INSERT/UPDATE/DELETE policies are untouched:
-- general users still cannot edit tickets they did not create (the
-- guard_ticket_update() trigger additionally constrains their own tickets),
-- and ticket_comments inserts still require creator/assignee/staff
-- involvement with the ticket.

DROP POLICY IF EXISTS tickets_select_scoped ON public.tickets;
CREATE POLICY tickets_select_scoped
  ON public.tickets FOR SELECT
  TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS ticket_comments_select_scoped ON public.ticket_comments;
CREATE POLICY ticket_comments_select_scoped
  ON public.ticket_comments FOR SELECT
  TO authenticated
  USING (public.is_active_user());
