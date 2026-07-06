# ITSMART — Unit Test Plan

**System:** Integrated Technology Support, Maintenance & Asset Resource Tracker  
**Organization:** DOST  
**Version:** 1.0  
**Date:** June 24, 2026  

---

## Overview

This document defines the unit test plan for the ITSMART application.  
Tests are organized by **user role** since access controls and visible functionality differ significantly across the three roles.

### Roles

| Role | Code | Description |
|------|------|-------------|
| Administrator | `administrator` | Full system access — manages assets, users, categories, and all tickets |
| Support Staff | `support_staff` | Manages and resolves assigned tickets, views assets and reports |
| General User | `general_user` | Submits tickets, views assigned assets, views own ticket history |

### Test ID Convention

`[ROLE_PREFIX]-[MODULE]-[NNN]`

- `ADM` = Administrator
- `SUP` = Support Staff
- `GEN` = General User
- `ALL` = All roles

---

## Section 1 — Authentication (All Roles)

### ALL-AUTH-001 · Login with valid credentials
- **Steps:** Navigate to `/login`, enter valid email and password, click Sign In.
- **Expected:** Redirected to `/dashboard`. User name visible in sidebar.

### ALL-AUTH-002 · Login with invalid credentials
- **Steps:** Enter incorrect password, click Sign In.
- **Expected:** Error toast "Login failed" appears. User stays on `/login`.

### ALL-AUTH-003 · Login with deactivated account
- **Steps:** Enter credentials for a deactivated user.
- **Expected:** Error toast "Account deactivated". User is NOT logged in.

### ALL-AUTH-004 · Forced password change on first login
- **Steps:** Log in with an account where `must_change_password = true`.
- **Expected:** Redirected to `/change-password` immediately. Dashboard is not accessible until password is changed.

### ALL-AUTH-005 · Change password — success
- **Steps:** On `/change-password`, enter correct current password, a new password, and matching confirmation.
- **Expected:** Toast "Password changed". Redirected to `/dashboard`. `password_changed_at` updates in Profile page.

### ALL-AUTH-006 · Change password — wrong current password
- **Steps:** Enter incorrect current password on `/change-password`.
- **Expected:** Toast "Incorrect current password". Password is NOT changed.

### ALL-AUTH-007 · Change password — new passwords do not match
- **Steps:** Enter non-matching new password and confirm fields.
- **Expected:** Inline "Passwords do not match" message. Submit button remains disabled.

### ALL-AUTH-008 · Change password — default password rejected
- **Steps:** Enter `dostro2` (any case: `DOSTRO2`, `Dostro2`) as new password.
- **Expected:** Toast "Choose a different password". Password is NOT changed.

### ALL-AUTH-009 · Password strength meter
- **Steps:** On `/change-password`, type passwords of increasing complexity.
- **Expected:** Strength bar progresses through Weak → Fair → Good → Strong.

### ALL-AUTH-010 · Logout
- **Steps:** Click "Sign Out" in the sidebar.
- **Expected:** Redirected to `/login`. React Query cache is cleared. Protected routes redirect to `/login`.

### ALL-AUTH-011 · Session persistence on page reload
- **Steps:** Log in, close and reopen the browser tab.
- **Expected:** User remains logged in. No redirect to `/login`.

### ALL-AUTH-012 · Unauthenticated access to protected routes
- **Steps:** While logged out, navigate directly to `/dashboard`, `/assets`, `/tickets`.
- **Expected:** Redirected to `/login` for all routes.

---

## Section 2 — Dashboard (All Roles)

### ALL-DASH-001 · KPI cards render correctly
- **Steps:** Log in as any role, navigate to `/dashboard`.
- **Expected:** Six KPI cards display: Total Assets, Active Assets, Inactive Assets, Open Tickets, In Progress Tickets, Resolved & Closed. Values are non-negative integers.

### ALL-DASH-002 · KPI cards link to filtered lists
- **Steps:** Click the "Open Tickets" KPI card.
- **Expected:** Navigates to `/tickets?status=open`. Ticket list is pre-filtered to Open status.

### ALL-DASH-003 · Recent tickets list
- **Steps:** Navigate to `/dashboard`.
- **Expected:** Up to 5 most recent tickets displayed with title, requester name, date, status badge, and priority badge. Each row links to the correct ticket detail page.

### ALL-DASH-004 · Asset status breakdown bar chart
- **Steps:** Navigate to `/dashboard`.
- **Expected:** Four bars shown for Active, Inactive, Maintenance, Retired. Percentages sum to 100% of total assets.

### ALL-DASH-005 · Ticket trend chart — week selector
- **Steps:** Change the week selector from 8 weeks to 4, 12, or 24 weeks.
- **Expected:** Chart updates with the correct number of weekly buckets. Date range label in header updates.

### ALL-DASH-006 · Ticket trend chart — empty state
- **Steps:** Log in on a fresh database with no tickets.
- **Expected:** "No ticket data available yet." message shown instead of the chart.

### ADM-DASH-007 · Support staff workload section (admin only)
- **Steps:** Log in as Administrator.
- **Expected:** Workload section visible, listing all support staff with in-progress and on-hold ticket counts and a relative workload bar.

### ADM-DASH-008 · Asset anomaly alerts (admin only)
- **Steps:** Log in as Administrator with assets that have anomalies (EOL, PM overdue, long maintenance, frequent reassignment).
- **Expected:** Asset Alerts card visible. Each anomaly shows asset name, tag, severity badge, and descriptive message. Clicking an alert navigates to the asset detail page.

### GEN-DASH-009 · General user sees no admin-only sections
- **Steps:** Log in as General User.
- **Expected:** Staff Workload and Asset Alerts sections are NOT visible.

---

## Section 3 — Asset Management

### 3.1 Asset List

#### ADM-ASSET-001 · Asset list loads with all assets
- **Steps:** Log in as Administrator, navigate to `/assets`.
- **Expected:** All assets displayed in a table with columns: Tag, Asset Details, Serial No., Location, Status, Assigned To, Actions.

#### ADM-ASSET-002 · Search by asset name
- **Steps:** Type a partial asset name in the search box.
- **Expected:** Table filters to assets whose name contains the search term. Case-insensitive.

#### ADM-ASSET-003 · Search by asset tag
- **Steps:** Type a partial asset tag (e.g. `DOST02`).
- **Expected:** Table filters to matching asset tags.

#### ADM-ASSET-004 · Search by category
- **Steps:** Type `laptop` in the search box.
- **Expected:** All laptops are returned.

#### ADM-ASSET-005 · Search + category filter combined
- **Steps:** Set category filter to "Laptop", then type a search term.
- **Expected:** Results are filtered by BOTH category and search term simultaneously.

#### ADM-ASSET-006 · Status filter
- **Steps:** Select "Retired" from the status dropdown.
- **Expected:** Only retired assets are shown.

#### ADM-ASSET-007 · Category filter
- **Steps:** Select "Server" from the category dropdown.
- **Expected:** Only server assets are shown.

#### ADM-ASSET-008 · Clear filters button
- **Steps:** Apply search + status filter, then click the "Clear" button.
- **Expected:** Search and filters reset. Full asset list reloads.

#### ADM-ASSET-009 · Pagination
- **Steps:** With more than 25 assets, navigate to page 2.
- **Expected:** Next 25 assets shown. Pagination bar shows correct page count and "Showing X–Y of Z".

#### ADM-ASSET-010 · Keyboard shortcut — N opens new asset dialog (admin)
- **Steps:** While on `/assets` (no input focused), press N.
- **Expected:** "Add New Asset" dialog opens with auto-generated asset tag pre-filled.

#### ADM-ASSET-011 · Keyboard shortcut — / focuses search
- **Steps:** Press `/` on the asset list.
- **Expected:** Cursor moves to the search input.

#### GEN-ASSET-012 · Scope toggle — Assigned to Me vs All Assets (non-admin)
- **Steps:** Log in as General User, navigate to `/assets`, toggle between "Assigned to Me" and "All Assets".
- **Expected:** "Assigned to Me" shows only assets assigned to the logged-in user. "All Assets" shows all.

#### GEN-ASSET-013 · General user cannot see New Asset button
- **Steps:** Log in as General User, navigate to `/assets`.
- **Expected:** "New Asset" button is NOT visible.

### 3.2 Create Asset (Administrator only)

#### ADM-ASSET-014 · Auto-generated asset tag
- **Steps:** Open "Add New Asset" dialog.
- **Expected:** Asset Tag field is pre-filled with the next sequential tag (`DOST02-ITA{YEAR}NNNNNN`) and is read-only.

#### ADM-ASSET-015 · Create asset — all required fields
- **Steps:** Fill in Name and Category (minimum required), submit form.
- **Expected:** Asset created successfully. Toast "Asset Saved!" shown. New asset appears in the list.

#### ADM-ASSET-016 · Create asset — validation
- **Steps:** Submit form with Name field empty.
- **Expected:** Validation error "Name is required" shown. Asset is NOT created.

#### ADM-ASSET-017 · Create asset — asset history entry created
- **Steps:** Create a new asset.
- **Expected:** Asset detail History tab shows a "✅ Created" entry with the asset tag and name.

### 3.3 Asset Detail — View

#### ALL-ASSET-018 · Asset detail page loads
- **Steps:** Click "View Details" on any asset in the list.
- **Expected:** Detail page loads showing asset name, tag, status badge, and three tabs: Details, History, Maintenance.

#### ALL-ASSET-019 · Details tab — all fields display correctly
- **Steps:** Open asset detail, view Details tab.
- **Expected:** Category, Model, Serial Number, Location, Purchase Date, Purchase Value, Last PM Date, Next PM Date, and Notes all display. Empty optional fields show `—`.

#### ALL-ASSET-020 · Overdue Next PM Date highlighted
- **Steps:** View an asset where Next PM Date is in the past.
- **Expected:** Next PM Date is shown in red with an "Overdue" label.

#### ALL-ASSET-021 · History tab — audit log entries
- **Steps:** Open History tab on an asset with history.
- **Expected:** Timeline entries shown in chronological order. Each entry shows action emoji/label, field name, old value (struck through in red), new value (in green), actor name, and timestamp.

#### ALL-ASSET-022 · Retirement remarks displayed in history
- **Steps:** View History tab on a retired asset that had remarks entered.
- **Expected:** `💬 Retirement Remarks` entry appears with the remark text in an amber-tinted block.

#### ALL-ASSET-023 · Maintenance tab — PM log entries
- **Steps:** Open Maintenance tab on an asset with maintenance records.
- **Expected:** PM entries listed with date performed, performed-by name, and description.

### 3.4 Asset Detail — Edit (Administrator only)

#### ADM-ASSET-024 · Edit asset — modify fields
- **Steps:** Click "Edit Asset", change Name and Location, click Save Changes.
- **Expected:** Toast "Asset updated successfully." Fields update on the detail page. History tab shows "✏️ Updated" entries for each changed field.

#### ADM-ASSET-025 · Edit asset — status change to inactive auto-unassigns
- **Steps:** Edit an assigned asset and set status to Inactive.
- **Expected:** `assignedTo` is cleared. History shows both "🔄 Status Changed" and "🔓 Unassigned" entries.

#### ADM-ASSET-026 · Edit form — retired option not selectable
- **Steps:** Open the edit form on a non-retired asset. Inspect the Status dropdown.
- **Expected:** "Retired" is NOT a selectable option. Only Active, Inactive, and Maintenance are available.

#### ADM-ASSET-027 · Edit form — retired asset shows locked status
- **Steps:** Open the edit form on a retired asset. Inspect the Status dropdown.
- **Expected:** A disabled "Retired (use Retire button)" option is shown. It cannot be selected.

#### ADM-ASSET-028 · Edit asset — cancel discards changes
- **Steps:** Click Edit, modify fields, click Cancel.
- **Expected:** No changes saved. Form closes and shows original values.

#### ADM-ASSET-029 · Browser close warning while editing
- **Steps:** Click Edit, type in a field, attempt to close/navigate away.
- **Expected:** Browser "Leave page?" confirmation dialog appears.

### 3.5 Assign / Unassign (Administrator only)

#### ADM-ASSET-030 · Assign asset to user
- **Steps:** Select a user from the "Reassign to" dropdown and click Assign.
- **Expected:** Assigned To card updates. Asset status changes to Active. History shows "👤 Assigned" entry.

#### ADM-ASSET-031 · Unassign asset
- **Steps:** Click Unassign on an assigned asset.
- **Expected:** Assigned To card shows "Currently Unassigned". Status changes to Inactive. History shows "🔓 Unassigned" entry.

#### ADM-ASSET-032 · Assignment locked for retired assets
- **Steps:** Navigate to a retired asset's detail page.
- **Expected:** The Reassign dropdown and Assign/Unassign buttons are NOT shown. A message "Assignment is locked for retired assets." is shown instead.

### 3.6 Retire Asset (Administrator only)

#### ADM-ASSET-033 · Retire button hidden when already retired
- **Steps:** Navigate to a retired asset's detail page.
- **Expected:** "Retire Asset" button is NOT visible.

#### ADM-ASSET-034 · Retire asset — without remarks
- **Steps:** Click "Retire Asset", leave remarks blank, click Retire Asset.
- **Expected:** Asset status changes to Retired. Toast confirms. History shows "📦 Retired" entry. No "💬 Retirement Remarks" entry.

#### ADM-ASSET-035 · Retire asset — with remarks
- **Steps:** Click "Retire Asset", enter remarks "Unserviceable — hard drive failure", click Retire Asset.
- **Expected:** History shows both "📦 Retired" and "💬 Retirement Remarks" entries. Remarks text reads exactly as entered.

#### ADM-ASSET-036 · Retire asset — auto-unassigns
- **Steps:** Retire an asset that is currently assigned to a user.
- **Expected:** Assigned To is cleared. History shows an "🔓 Unassigned" entry alongside the retirement entry.

#### ADM-ASSET-037 · Retire dialog — Cancel closes without action
- **Steps:** Open the Retire dialog, type remarks, click Cancel.
- **Expected:** Dialog closes. Asset status unchanged. No history entry added. Remarks field cleared when dialog reopens.

### 3.7 Maintenance Log (Administrator only)

#### ADM-ASSET-038 · Log maintenance — all fields
- **Steps:** In the Maintenance tab, enter Date Performed, select Performed By, add a description, click "Log Maintenance".
- **Expected:** New PM entry appears in the Maintenance log. Last PM Date and Next PM Date on the asset update automatically based on category interval. History shows "🔧 PM Recorded" and "📅 PM Scheduled" entries.

#### ADM-ASSET-039 · Log maintenance — date required
- **Steps:** Leave Date Performed empty, click "Log Maintenance".
- **Expected:** No action taken (button has no effect without a date).

#### ADM-ASSET-040 · Next PM date interval by category
- **Steps:** Log maintenance on a Laptop (6-month interval) and a Server (3-month interval).
- **Expected:** Next PM Date = performedAt + 6 months for Laptop; + 3 months for Server.

### 3.8 QR Label

#### ALL-ASSET-041 · QR code renders
- **Steps:** Navigate to any asset detail page.
- **Expected:** QR code image displays on the right sidebar with the asset tag below it.

#### ALL-ASSET-042 · Print label opens print window
- **Steps:** Click "Print Label".
- **Expected:** A new print window opens showing a formatted label with the QR code, asset tag, name, category, location, and serial number. Print dialog is triggered.

---

## Section 4 — Ticket Management

### 4.1 Ticket List

#### ALL-TICKET-001 · Ticket list loads
- **Steps:** Navigate to `/tickets` as any role.
- **Expected:** Table shows columns: Ticket, Status & Priority, SLA, Requester, Assigned To, Created, Actions.

#### ALL-TICKET-002 · Search by title
- **Steps:** Type a partial ticket title in the search box.
- **Expected:** Only tickets with matching titles shown. Case-insensitive.

#### ALL-TICKET-003 · Search by ticket number
- **Steps:** Type the ticket number (e.g. `TKT-0001`) in the search box.
- **Expected:** Matching ticket shown.

#### ALL-TICKET-004 · Search by requester name
- **Steps:** Type a requester's name.
- **Expected:** Tickets created by that requester are shown.

#### ALL-TICKET-005 · Status filter
- **Steps:** Select "In Progress" from the status dropdown.
- **Expected:** Only in-progress tickets shown.

#### ALL-TICKET-006 · Priority filter
- **Steps:** Select "Critical - 1" from the priority dropdown.
- **Expected:** Only critical tickets shown.

#### ADM-TICKET-007 · Assignee filter (admin)
- **Steps:** Select a specific support staff member from the "Assigned To" filter.
- **Expected:** Only tickets assigned to that staff member shown.

#### ADM-TICKET-008 · Assignee filter — Unassigned (admin)
- **Steps:** Select "Unassigned" from the Assigned To filter.
- **Expected:** Only tickets with no assignee shown.

#### ALL-TICKET-009 · Active filter chips
- **Steps:** Apply status and priority filters.
- **Expected:** Filter chips appear below the filter bar showing active filters. Clicking Clear removes all.

#### ALL-TICKET-010 · Row color coding
- **Steps:** View the ticket list with tickets in various states.
- **Expected:** Closed = gray, Resolved = green, In Progress = blue, On Hold = neutral, Open (high/critical) = orange, Open (low/medium) = yellow.

#### ALL-TICKET-011 · SLA badge displayed
- **Steps:** View any active ticket in the list.
- **Expected:** SLA compact badge visible showing remaining time, elapsed time, or overdue status with appropriate color (blue=pending, amber=at risk, red=breached, gray=paused).

#### GEN-TICKET-012 · Scope toggle — My Tickets vs All Tickets (general user)
- **Steps:** Log in as General User. Toggle between "My Tickets" and "All Tickets".
- **Expected:** "My Tickets" shows only tickets created by the logged-in user. "All Tickets" shows all.

#### SUP-TICKET-013 · Scope toggle — Assigned to Me vs All (support staff)
- **Steps:** Log in as Support Staff. Toggle between "Assigned to Me" and "All Tickets".
- **Expected:** "Assigned to Me" shows only tickets assigned to this staff member.

#### ALL-TICKET-014 · Keyboard shortcut — N opens new ticket dialog
- **Steps:** While on `/tickets` (no input focused), press N.
- **Expected:** "Create Support Ticket" dialog opens.

#### ALL-TICKET-015 · Keyboard shortcut — / focuses search
- **Steps:** Press `/` on the ticket list.
- **Expected:** Search input receives focus.

### 4.2 Create Ticket

#### ALL-TICKET-016 · Create ticket — required fields validation
- **Steps:** Open New Ticket dialog, leave Title or Description blank, submit.
- **Expected:** Validation errors shown. Ticket NOT created.

#### ALL-TICKET-017 · Create ticket — success
- **Steps:** Fill in Title, Description, Priority, and Type. Click Submit Ticket.
- **Expected:** Toast "Ticket Submitted!". Ticket appears in the list with status "Open". Ticket is created by the logged-in user.

#### ALL-TICKET-018 · Create ticket — with related asset
- **Steps:** Open New Ticket, search for an asset in the combobox, select it, submit.
- **Expected:** Ticket created with the selected asset linked. Asset name shown in ticket detail.

#### ALL-TICKET-019 · Create ticket — asset search combobox
- **Steps:** Open the Related Asset combobox, type a partial asset name, tag, or category.
- **Expected:** Matching assets shown in the dropdown. Non-matching assets filtered out.

### 4.3 Ticket Detail — View

#### ALL-TICKET-020 · Ticket detail loads
- **Steps:** Click "View" on any ticket.
- **Expected:** Detail page shows ticket number (copyable), title, status/priority badges, ticket type, description, requester, and timestamp. Activity log visible.

#### ALL-TICKET-021 · Copy ticket number
- **Steps:** Click the copy icon next to the ticket number.
- **Expected:** Ticket number copied to clipboard. Icon briefly changes to a checkmark.

#### ALL-TICKET-022 · SLA full card
- **Steps:** View any open ticket detail page.
- **Expected:** Full SLA card shows SLA status, progress bar, target hours, and deadline date/time. Clock pauses (paused state) when ticket is on hold.

#### ALL-TICKET-023 · Activity log — system entries vs user comments
- **Steps:** View a ticket with both status-change entries and user comments.
- **Expected:** System entries (starting with emoji) rendered as compact timeline items. User comments rendered as cards with commenter name, timestamp, and message body.

#### ALL-TICKET-024 · Print ticket
- **Steps:** Click the Printer icon on a ticket.
- **Expected:** A new print window opens with ticket details, description, and the full activity log. Print dialog triggered.

### 4.4 Ticket Status Transitions

#### ADM-TICKET-025 · Admin allowed transitions
- **Steps:** As Administrator, view tickets in each status and inspect the Update Status dropdown.
- **Expected:** Open → In Progress, Close. In Progress → Open, On Hold, Resolved. On Hold → In Progress, Open. Resolved → In Progress, Close. Closed → no transitions.

#### SUP-TICKET-026 · Support staff allowed transitions
- **Steps:** As Support Staff, inspect transitions on an assigned ticket.
- **Expected:** Open → In Progress, Close. In Progress → Open, On Hold, Resolved. On Hold → In Progress (cannot go back to Open). Resolved → In Progress, Close. Closed → none.

#### GEN-TICKET-027 · General user — limited transitions
- **Steps:** As General User, view a resolved ticket they created.
- **Expected:** Status dropdown shows only "In Progress" (reopen) and "Closed". No other statuses available.

#### ALL-TICKET-028 · Remarks dialog required for On Hold, Resolved, Closed
- **Steps:** Change status to "On Hold", "Resolved", or "Closed".
- **Expected:** A dialog opens requiring remarks. Confirm button is disabled until remarks are entered.

#### ALL-TICKET-029 · Remarks saved in activity log
- **Steps:** Change status to Resolved with remarks "Issue resolved after reboot".
- **Expected:** Activity log entry reads: `🔄 Status changed to "Resolved" by [Name].` followed by `📝 Remarks: Issue resolved after reboot`.

#### ALL-TICKET-030 · Close ticket — confirmation dialog with destructive warning
- **Steps:** Change status to Closed.
- **Expected:** Dialog title shows a warning icon with "Close Ticket?". Confirm button is red. Remarks are required.

#### ALL-TICKET-031 · Closed ticket — no further actions
- **Steps:** View a closed ticket.
- **Expected:** Management panel shows "This ticket is closed — no further actions allowed." No status dropdown or assign controls visible.

### 4.5 Ticket Assignment (Administrator and Support Staff)

#### ADM-TICKET-032 · Assign ticket to support staff
- **Steps:** Select a support staff member from the Assignee dropdown and confirm.
- **Expected:** Ticket assigned. Status auto-transitions to In Progress if it was Open. Activity log entry: "👤 Ticket assigned to [Name] by [Admin]."

#### ADM-TICKET-033 · Staff ranked by workload
- **Steps:** Open the assignee dropdown.
- **Expected:** Support staff listed in order of fewest active tickets first (lowest workload at the top).

#### ADM-TICKET-034 · Unassign ticket
- **Steps:** Select "Unassigned" from the assignee dropdown.
- **Expected:** Ticket unassigned. Status reverts to Open if it was In Progress. Activity log entry: "🔓 Ticket unassigned by [Name]."

### 4.6 Priority Changes (Administrator only)

#### ADM-TICKET-035 · Change priority — confirmation dialog
- **Steps:** Change ticket priority from Medium to Critical.
- **Expected:** Confirmation dialog shows old → new priority. Confirm button available.

#### ADM-TICKET-036 · Priority change logged
- **Steps:** Confirm a priority change.
- **Expected:** Activity log: "⬆️ Priority changed from Medium - 3 to Critical - 1 by [Admin]."

### 4.7 Comments

#### ALL-TICKET-037 · Add comment
- **Steps:** Type a comment in the reply box and click Send Reply.
- **Expected:** Comment appears in activity log with commenter's name and timestamp.

#### ALL-TICKET-038 · Comment character limit
- **Steps:** Type more than 1000 characters.
- **Expected:** Input is capped at 1000. Character counter turns red. Send button remains enabled.

#### ALL-TICKET-039 · Empty comment not submittable
- **Steps:** Leave comment box empty or whitespace-only.
- **Expected:** Send Reply button is disabled.

#### ALL-TICKET-040 · No comment box on closed ticket
- **Steps:** View a closed ticket.
- **Expected:** Reply textarea is NOT shown.

### 4.8 Satisfaction Rating (General User — on resolved tickets they created)

#### GEN-TICKET-041 · Rating form visible on resolved ticket
- **Steps:** As General User, view a resolved ticket they created.
- **Expected:** Star rating widget (1–5) and optional comment field visible in the Management panel.

#### GEN-TICKET-042 · Submit satisfaction rating
- **Steps:** Select 4 stars, enter a comment, click Submit.
- **Expected:** Toast "Thank you!" Rating saved. Stars displayed in management panel.

#### GEN-TICKET-043 · Rating visible to admin on closed ticket
- **Steps:** As Administrator, view a closed ticket with a satisfaction rating.
- **Expected:** Star rating and comment shown in the management panel under "User Satisfaction".

---

## Section 5 — Reports

### 5.1 General Report Navigation

#### ADM-RPT-001 · Report navigation menu
- **Steps:** Log in as Administrator, navigate to `/reports`.
- **Expected:** Left nav shows three groups — Assets (Inventory, History, Unassigned, Depreciation), Tickets (Tickets, Performance, Satisfaction), Admin (User Activity). All 8 reports accessible.

#### SUP-RPT-002 · Support staff report access
- **Steps:** Log in as Support Staff, navigate to `/reports`.
- **Expected:** Visible reports: Asset Inventory, Ticket List, Ticket Performance, Ticket Satisfaction. Asset History, Unassigned, Depreciation, User Activity NOT visible.

#### GEN-RPT-003 · General user report access
- **Steps:** Log in as General User, navigate to `/reports`.
- **Expected:** Only Ticket List report visible. All asset and admin reports NOT visible.

### 5.2 Asset Inventory Report (Admin, Support Staff)

#### ADM-RPT-004 · Preview table renders
- **Steps:** Select Asset Inventory report.
- **Expected:** Preview table shows up to 10 rows with columns: Tag, Name, Category, Status, Serial No., Location, Assigned To, Purchase Date, Value.

#### ADM-RPT-005 · Status filter
- **Steps:** Select "Retired" from the Status dropdown.
- **Expected:** Preview updates to show only retired assets.

#### ADM-RPT-006 · Date range filter
- **Steps:** Set From and To dates.
- **Expected:** Preview updates to assets created within the date range. Row count updates.

#### ADM-RPT-007 · Export to Excel
- **Steps:** Click Excel button.
- **Expected:** `.xlsx` file downloaded. Contains all filtered assets with all columns.

#### ADM-RPT-008 · Export to PDF
- **Steps:** Click PDF button.
- **Expected:** `.pdf` file downloaded. Contains title, generation date, applied filters, and table of assets.

#### ADM-RPT-009 · Export disabled with no data
- **Steps:** Apply filters that return 0 assets.
- **Expected:** Both Excel and PDF buttons are disabled.

### 5.3 Asset History Report (Admin only)

#### ADM-RPT-010 · History preview table
- **Steps:** Select Asset History report.
- **Expected:** Preview shows: Asset Tag, Asset Name, Action, Field, Old Value, New Value, Changed By, Date.

#### ADM-RPT-011 · Date range filter on history
- **Steps:** Set From/To dates.
- **Expected:** Only history entries within that date range shown.

#### ADM-RPT-012 · Retirement remarks action visible in export
- **Steps:** Export history for an asset that was retired with remarks.
- **Expected:** Export includes a row with Action = `retire_remarks`, New Value = the entered remarks.

### 5.4 Unassigned Assets Report (Admin only)

#### ADM-RPT-013 · Unassigned assets preview
- **Steps:** Select Unassigned Assets report.
- **Expected:** Only assets with no assigned user are shown.

### 5.5 Asset Depreciation Report (Admin only)

#### ADM-RPT-014 · Depreciation calculations
- **Steps:** Select Depreciation report with assets that have purchase value and date.
- **Expected:** Age (years), Current Value, and % Depreciated calculated correctly using straight-line depreciation over 5 years.

#### ADM-RPT-015 · Assets without purchase data excluded
- **Steps:** View Depreciation report.
- **Expected:** Assets missing `purchaseValue` or `purchaseDate` are NOT listed.

### 5.6 Ticket List Report (All roles — scoped)

#### GEN-RPT-016 · General user sees only their own tickets
- **Steps:** As General User, view Ticket List report.
- **Expected:** Badge reads "Your tickets". Only tickets created by the logged-in user appear in the preview.

#### SUP-RPT-017 · Support staff sees assigned tickets
- **Steps:** As Support Staff, view Ticket List report.
- **Expected:** Badge reads "Assigned to you". Only tickets assigned to the logged-in staff member appear.

#### ADM-RPT-018 · Status and priority filters
- **Steps:** Set status = "Resolved", priority = "High - 2".
- **Expected:** Preview updates to show only resolved, high-priority tickets.

### 5.7 Ticket Performance Report (Admin, Support Staff)

#### ADM-RPT-019 · Performance preview
- **Steps:** Select Ticket Performance report.
- **Expected:** Preview shows: Ticket No., Title, Priority, Assigned To, Created, Resolved, Resolution Time (h), SLA Target (h), SLA Status (Met/Breached/Pending).

#### ADM-RPT-020 · SLA met vs breached correct
- **Steps:** View export for a ticket resolved within SLA target.
- **Expected:** SLA Status = "Met". For a ticket resolved late, "Breached".

### 5.8 Ticket Satisfaction Report (Admin, Support Staff)

#### ADM-RPT-021 · Average rating banner
- **Steps:** Select Ticket Satisfaction report with rated tickets present.
- **Expected:** Amber banner shows average score (e.g. "4.2/5.0") and total rated ticket count.

#### ADM-RPT-022 · Only rated tickets in preview
- **Steps:** View Ticket Satisfaction report.
- **Expected:** Only tickets with a satisfaction rating appear. Unrated tickets excluded.

### 5.9 User Activity Report (Admin only)

#### ADM-RPT-023 · User activity columns
- **Steps:** Select User Activity report.
- **Expected:** Preview shows: Full Name, Role, Department, Status, Assets Assigned, Tickets Created, Tickets Resolved.

---

## Section 6 — Calendar

### ALL-CAL-001 · Calendar loads current month
- **Steps:** Navigate to `/calendar`.
- **Expected:** Calendar grid shows the current month. Today's date highlighted with a filled circle.

### ALL-CAL-002 · Ticket created events appear
- **Steps:** View calendar on the day a ticket was created.
- **Expected:** A yellow `ticket_open` event badge appears on that day.

### ALL-CAL-003 · SLA deadline events appear
- **Steps:** View calendar for an open/in-progress ticket.
- **Expected:** A red `ticket_due` event badge appears on the SLA deadline date.

### ALL-CAL-004 · SLA deadline accounts for hold time
- **Steps:** View a ticket that was on hold for N hours. Check its SLA deadline event on the calendar.
- **Expected:** Deadline is shifted forward by the hold time — not the raw `createdAt + targetHours`.

### ALL-CAL-005 · Resolved ticket events appear
- **Steps:** View calendar on the day a ticket was resolved.
- **Expected:** A green `ticket_resolved` badge appears.

### SUP-CAL-006 · PM due events visible (admin and support staff)
- **Steps:** Log in as Support Staff or Admin. View calendar on a day with a Next PM Date.
- **Expected:** Blue `pm_due` badge appears for the asset.

### SUP-CAL-007 · EOL events visible (admin and support staff)
- **Steps:** Log in as Support Staff or Admin. View calendar for an asset reaching end of life.
- **Expected:** Orange `asset_eol` badge appears on the EOL date.

### GEN-CAL-008 · PM and EOL events hidden from general users
- **Steps:** Log in as General User. View calendar.
- **Expected:** PM Due and End of Life event types are NOT shown.

### ALL-CAL-009 · Day click shows events list
- **Steps:** Click a day cell with events.
- **Expected:** Side panel shows the full list of events for that day, with title and subtitle.

### ALL-CAL-010 · Event click navigates to detail
- **Steps:** Click an event in the side panel.
- **Expected:** Navigates to the associated ticket or asset detail page.

### ALL-CAL-011 · Upcoming 7 days panel
- **Steps:** View the calendar.
- **Expected:** "Upcoming (7 days)" panel shows up to 8 events sorted by date ascending.

### ALL-CAL-012 · Legend filter toggles event types
- **Steps:** Click the "SLA Deadline" legend button to deactivate it.
- **Expected:** All `ticket_due` events disappear from the calendar grid and upcoming panel. Button dims.

### ALL-CAL-013 · Month navigation
- **Steps:** Click the left/right chevron buttons to change months.
- **Expected:** Calendar grid updates to the correct month. Events for that month appear.

---

## Section 7 — User Management (Administrator only)

### ADM-USER-001 · Non-admin redirected away
- **Steps:** As General User or Support Staff, navigate to `/admin/users`.
- **Expected:** Redirected to `/dashboard`.

### ADM-USER-002 · User list loads
- **Steps:** As Administrator, navigate to `/admin/users`.
- **Expected:** Table shows all users with columns: Name/Email, Department, Joined, Last Login, Status, Role, Actions.

### ADM-USER-003 · Search users
- **Steps:** Type a name or email in the search box.
- **Expected:** Table filters to matching users.

### ADM-USER-004 · Add new user — success
- **Steps:** Click "Add User", fill in Full Name, Email, Department (optional), Role. Click Create User.
- **Expected:** Toast "User created". New user appears in the list. Default password is `dostro2`.

### ADM-USER-005 · Add new user — missing required fields
- **Steps:** Submit Add User form with Email or Full Name blank.
- **Expected:** Toast "Missing fields — Email and full name are required." User NOT created.

### ADM-USER-006 · Change user role
- **Steps:** Change a General User to Support Staff via the role dropdown.
- **Expected:** Role updates immediately. Changes reflected in the table.

### ADM-USER-007 · Admin cannot change own role
- **Steps:** View own row in the user table.
- **Expected:** Role dropdown for the logged-in admin is disabled.

### ADM-USER-008 · Deactivate user
- **Steps:** Click "Deactivate" for a user.
- **Expected:** Status badge changes to "Inactive". Toast "User deactivated". The deactivated user can no longer log in.

### ADM-USER-009 · Activate user
- **Steps:** Click "Activate" for an inactive user.
- **Expected:** Status badge changes to "Active". Toast "User activated".

### ADM-USER-010 · Admin cannot deactivate themselves
- **Steps:** View own row.
- **Expected:** Deactivate/Activate button NOT shown for the logged-in user's row.

### ADM-USER-011 · Reset password
- **Steps:** Click "Reset Password" for a user, confirm in the dialog.
- **Expected:** Toast "Password reset". User's password set to `dostro2`. On next login, user is forced to change it.

---

## Section 8 — Category Management (Administrator only)

### ADM-CAT-001 · Non-admin redirected away
- **Steps:** As Support Staff or General User, navigate to `/admin/categories`.
- **Expected:** Redirected to `/dashboard`.

### ADM-CAT-002 · Category list loads
- **Steps:** As Administrator, navigate to `/admin/categories`.
- **Expected:** All custom categories displayed with Name and Type columns.

### ADM-CAT-003 · Create category
- **Steps:** Click "Add Category", enter Name and Type, submit.
- **Expected:** Toast "Category created." New category appears in the list immediately (React Query cache refreshed).

### ADM-CAT-004 · Create category — validation
- **Steps:** Submit with Name or Type blank.
- **Expected:** Validation errors shown. Category NOT created.

### ADM-CAT-005 · Delete category
- **Steps:** Click the trash icon for a category, confirm.
- **Expected:** Toast "Deleted." Category removed from the list immediately (React Query cache refreshed).

---

## Section 9 — User Profile (All Roles)

### ALL-PROF-001 · Profile page loads
- **Steps:** Click on user name/icon in the sidebar footer or navigate to `/profile`.
- **Expected:** Profile page shows avatar, full name, role badge, and email badge.

### ALL-PROF-002 · Update full name and department
- **Steps:** Change Full Name and Department, click Save Changes.
- **Expected:** Toast "Profile updated". Sidebar footer reflects updated name.

### ALL-PROF-003 · Name validation
- **Steps:** Clear the Full Name field, click Save.
- **Expected:** Validation error "Full name is required." Profile NOT updated.

### ALL-PROF-004 · Last password changed date
- **Steps:** View the Password section of the Profile page.
- **Expected:** If password was changed, shows "Last changed X ago" with an exact date on hover. If never changed, shows "Password has never been changed."

### ALL-PROF-005 · Change password link
- **Steps:** Click "Change Password" button on profile.
- **Expected:** Navigates to `/change-password`.

---

## Section 10 — Notifications (All Roles)

### ALL-NOTIF-001 · Bell icon shows unread count
- **Steps:** Receive a new notification (e.g. ticket assigned, asset assigned).
- **Expected:** Red badge appears on the bell icon with the unread count. Shows "99+" when over 99.

### ALL-NOTIF-002 · Open notification panel
- **Steps:** Click the bell icon in the header.
- **Expected:** Dropdown panel opens showing notification list with icon, title, body, and relative time.

### ALL-NOTIF-003 · Unread notifications highlighted
- **Steps:** View the notification panel with unread notifications.
- **Expected:** Unread items have a blue-tinted background and a blue dot indicator.

### ALL-NOTIF-004 · Click notification marks as read and navigates
- **Steps:** Click an unread notification with a link.
- **Expected:** Notification marked as read (blue highlight removed). Navigates to the linked page. Panel closes.

### ALL-NOTIF-005 · Mark all as read
- **Steps:** Click "Mark all read" button.
- **Expected:** All notifications marked as read. Unread badge on bell disappears.

### ALL-NOTIF-006 · Clear all notifications
- **Steps:** Click "Clear all" button.
- **Expected:** All notifications removed from the list. Panel shows "No notifications yet."

### ALL-NOTIF-007 · Close panel on outside click
- **Steps:** Open notification panel, click anywhere outside it.
- **Expected:** Panel closes.

### ALL-NOTIF-008 · Real-time notifications
- **Steps:** With two browser sessions open (same user), trigger a notification-generating event in one.
- **Expected:** Bell badge and panel update in the other session without page reload.

---

## Section 11 — Navigation & Layout (All Roles)

### ALL-NAV-001 · Sidebar active state
- **Steps:** Navigate to each main route.
- **Expected:** The corresponding sidebar link is highlighted.

### ALL-NAV-002 · Sidebar collapse/expand
- **Steps:** Click the collapse toggle button at the bottom of the sidebar.
- **Expected:** Sidebar collapses to icon-only (64px wide). Content area expands. Preference persisted in localStorage.

### ALL-NAV-003 · Sidebar collapsed — tooltips on hover
- **Steps:** Collapse the sidebar, hover over each nav icon.
- **Expected:** Tooltip showing the page name appears to the right of each icon.

### ALL-NAV-004 · Admin-only nav items
- **Steps:** Log in as General User or Support Staff.
- **Expected:** "Users" and "Categories" links are NOT shown in the sidebar.

### ALL-NAV-005 · Header page title updates
- **Steps:** Navigate to different pages.
- **Expected:** Header title changes to match: Dashboard, Assets, Tickets, Reports, Calendar, My Profile, etc.

### ALL-NAV-006 · Role-changed session invalidation
- **Steps:** While logged in, have an admin change the current user's role.
- **Expected:** User is automatically signed out with toast "Role changed — please sign in again."

### ALL-NAV-007 · Account deactivated session invalidation
- **Steps:** While logged in, have an admin deactivate the current user's account.
- **Expected:** User is automatically signed out with toast "Account deactivated."

---

## Section 12 — SLA Engine

### ALL-SLA-001 · Pending status — within SLA
- **Steps:** View a new open ticket (< 75% of target time elapsed).
- **Expected:** SLA badge shows blue "pending" color with "Xh Ym remaining".

### ALL-SLA-002 · At-risk status — 75%+ elapsed
- **Steps:** View a ticket where ≥ 75% of SLA time has elapsed but deadline not yet passed.
- **Expected:** SLA badge shows amber "at_risk" color.

### ALL-SLA-003 · Breached status
- **Steps:** View a ticket past its SLA deadline.
- **Expected:** SLA badge shows red "breached" color with "Overdue by Xh Ym".

### ALL-SLA-004 · Paused status — on hold
- **Steps:** View a ticket with status "On Hold".
- **Expected:** SLA badge shows gray "paused" color with "⏸ Paused (on hold)".

### ALL-SLA-005 · Met status — resolved within SLA
- **Steps:** View a resolved ticket that was resolved before its SLA deadline.
- **Expected:** SLA badge shows green "met" color with "Resolved in Xh Ym".

### ALL-SLA-006 · Breached at resolution
- **Steps:** View a resolved ticket that was resolved after its SLA deadline.
- **Expected:** SLA badge shows red "breached" color with "Breached by Xh Ym".

### ALL-SLA-007 · Hold time deducted from elapsed time
- **Steps:** View a ticket that was on hold for 2 hours. SLA target is 8 hours. Actual wall clock elapsed is 6 hours.
- **Expected:** Effective elapsed time = 4 hours (6 - 2). Remaining = 4 hours. Status = pending.

### ALL-SLA-008 · SLA target by priority
- **Steps:** Check SLA targets for tickets of each priority.
- **Expected:** Critical = 4h, High = 8h, Medium = 24h, Low = 72h.

---

## Section 13 — Asset Anomaly Detection (Administrator only)

### ADM-ANOM-001 · Frequent reassignment alert
- **Steps:** Assign and unassign an asset 3+ times within 30 days.
- **Expected:** Dashboard shows a "Zap" anomaly alert: "Reassigned N times in the last 30 days". Severity = warning at 3+, critical at 5+.

### ADM-ANOM-002 · Long maintenance alert
- **Steps:** Set an asset to Maintenance status and leave it for 30+ days (simulate by setting `updated_at` in the past).
- **Expected:** Dashboard shows a "Wrench" anomaly: "In maintenance for N days". Warning at 30d, critical at 60d.

### ADM-ANOM-003 · Inactive long alert
- **Steps:** Asset with status Inactive, `updated_at` more than 1 year ago.
- **Expected:** Dashboard shows "Archive" anomaly: "Inactive for N months — consider retiring". Severity = warning.

### ADM-ANOM-004 · End of life alert
- **Steps:** Asset with `purchase_date` older than the useful life for its category (e.g. Laptop > 4 years old).
- **Expected:** Dashboard shows "AlertTriangle" anomaly: "Reached end of life (N-year lifespan, purchased YYYY)". Warning in EOL year, critical after.

### ADM-ANOM-005 · PM overdue alert
- **Steps:** Asset with `next_pm_date` in the past.
- **Expected:** Dashboard shows "Wrench" anomaly: "Preventive maintenance was due on [date]". Severity = warning.

### ADM-ANOM-006 · Anomaly links to asset detail
- **Steps:** Click an anomaly row on the dashboard.
- **Expected:** Navigates to the relevant asset's detail page.

---

## Appendix A — Test Execution Summary Template

| Test ID | Test Name | Tester | Date | Result | Notes |
|---------|-----------|--------|------|--------|-------|
| ALL-AUTH-001 | Login with valid credentials | | | Pass / Fail | |
| ALL-AUTH-002 | Login with invalid credentials | | | Pass / Fail | |
| ... | | | | | |

---

## Appendix B — Role Test Accounts Required

| Role | Suggested Username | Notes |
|------|--------------------|-------|
| Administrator | admin@dost.gov.ph | Full access. Used for all ADM-prefixed tests. |
| Support Staff | support@dost.gov.ph | Must have tickets assigned before running SUP tests. |
| General User | user@dost.gov.ph | Must have assets assigned and tickets created. |
| Deactivated User | deactivated@dost.gov.ph | Required for ALL-AUTH-003. |
| Forced PW Change | newuser@dost.gov.ph | `must_change_password = true` required for ALL-AUTH-004. |

---

## Appendix C — Test Data Prerequisites

- At least 30 assets in various statuses (active, inactive, maintenance, retired)
- At least 5 assets with anomaly conditions (EOL, PM overdue, long maintenance)
- At least 20 tickets in various statuses and priorities
- At least 1 ticket on hold with hold time > 1 hour
- At least 1 ticket with a satisfaction rating
- At least 2 support staff users with different workloads
- Assets with PM logs and purchase data for depreciation testing
