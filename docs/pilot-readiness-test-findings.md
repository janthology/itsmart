# Pilot-readiness test findings

Tested against a local production build using synthetic browser sessions and intercepted Supabase requests. No pilot data was reset or modified. The role-page fixture denies writes by default; individual password-flow requests are simulated locally. These checks are not a substitute for a live-backend authorization/integration test or a manual UX review.

## Findings and remediation

The five audit findings have been addressed in the frontend and have regression tests:

1. **Password change partial success:** A successful Auth change followed by a failed or zero-row profile update is now explained as an incomplete account update. The new password is active; the user can retry the profile update without changing the password again. The Auth and profile updates remain separate, not atomic. If the user reloads before finishing, they must use the new password as their current password.
2. **Maintenance and history read errors:** Each tab now shows an error and retry action instead of an empty state when its query fails.
3. **Unassigned assets:** The misleading “Days Unassigned” column was removed from Excel; reliable duration cannot be inferred from purchase date.
4. **Depreciation:** Preview, Excel and PDF use the same five-year estimate. Zero cost has an unavailable percentage (blank in Excel, N/A in the UI/PDF); a future purchase stays at cost with zero accumulated depreciation until its purchase date. Invalid values are unavailable. These are estimates, not accounting-policy determinations.
5. **Password accessibility:** Labels are associated with inputs and visibility buttons have accessible names.

Regression coverage uses mocked authentication and database responses, not a live Supabase integration. It cannot prove the password and profile operations are atomic or validate live policy behavior.

## Coverage and limits

- Automated browser smoke visits dashboard, asset list/detail, ticket list/detail, calendar, reports, profile, change password and not-found with each of administrator, support staff and general user. Separate tests check user-management access and selected ticket/report controls; existing tests cover maintenance forms and performance reports. Signed-out tests cover login, redirects and the manifest.
- One general-user synthetic-data run checks document-level horizontal overflow at a 390px viewport after each page renders. It does not prove visual quality, dialog usability, keyboard navigation, zoom support, or that every element fits.
- Unit tests cover date/SLA calculations, performance exports, mappings, pagination, dashboard metrics, user filters and labels. The full-source V8 unit-coverage measurement at the original audit was **5.45% lines, 5.88% branches**; browser coverage is not included. Run `corepack pnpm --filter @workspace/itam run test:coverage` to repeat it.
- Important unverified flows include real authentication/password updates, full ticket lifecycle and comments, user creation/reset, asset creation/assignment, report downloads beyond targeted mock checks, real notification and cron behavior, and backend enforcement under actual sessions. Mocked UI authorization does not prove RLS. Previous maintenance-specific rollback-only database checks are separate from this audit.
- Before reset, do a manual role-by-role pass using `docs/smoke-test-checklist.md` against an isolated test environment with disposable accounts and records, plus error, accessibility, mobile/zoom and print checks. Do not use destructive production tests or delete pilot data without separate approval and a verified backup.
