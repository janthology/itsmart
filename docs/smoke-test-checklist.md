# Smoke Test Checklist

Run this checklist after every deployment (preview or production) and before
merging any change that touches auth, tickets, or the database. It takes
about 10 minutes. Mark each item Pass/Fail with the build/commit tested.

Tested build/commit: ____________  Date: ____________  Tester: ____________

## Accounts
- [ ] Administrator: Neil P. dela Cruz
- [ ] Support staff: charles white
- [ ] General user: Test User

## Auth
- [ ] Admin login reaches the dashboard (no redirect loop)
- [ ] Support staff login reaches the dashboard
- [ ] General user login reaches the dashboard
- [ ] Logout returns to the login page
- [ ] `/register` redirects to the login page (public signup is disabled)

## Administrator
- [ ] Dashboard cards show correct counts (assets + ticket lifecycle)
- [ ] Support Tickets: "All tickets" shows the whole queue; "My tickets"
      shows Assigned to me / Submitted by me groups
- [ ] Open a ticket → change Status, Priority, Type, and Assignee; saved
- [ ] User Management: create a user → one-time temporary password dialog
      appears once and can be copied
- [ ] User Management: reset a password → new one-time temporary password
      dialog appears; the reset user is asked to change it at next login
- [ ] Reset user who is currently logged in is pushed to change password

## Support staff
- [ ] Dashboard "Open tickets" card shows the organization-wide open count
      and opens Tickets with `scope=all`
- [ ] Dashboard other cards match "My tickets" (assigned or submitted)
- [ ] Ticket detail: Type can be edited and saved
- [ ] Ticket detail: Assign To shows the ★ Suggested assignee

## General user
- [ ] Dashboard cards: My tickets, Open, In progress, Resolved, Closed,
      My assets
- [ ] Tickets page: "My tickets" shows submitted tickets; "All tickets"
      shows the organization-wide list (read view)
- [ ] Cannot edit another user's ticket (no Ticket Management controls)

## Calendar & misc
- [ ] Calendar opens with today selected; "Next 7 days" shows overdue
      deadlines first (marked Overdue)
- [ ] Print ticket / print asset QR label render correctly (this also
      exercises the HTML-escaping in the print views)
- [ ] Resolved ticket shows auto-close timing note; closed ticket shows
      whether it was resolved first or closed directly

## Infrastructure reminders
- [ ] Supabase `DOST02-ITSMART`: confirm scheduled backups are visible in
      Dashboard → Database → Backups (PITR requires a paid add-on)
- [ ] For future database changes: create a Supabase branch first, apply
      and verify the migration there, then merge to production
- [ ] Old project `DOST2-ITASM` (separate organization): export a final
      backup, then pause/delete it — it still holds pre-hardening data
