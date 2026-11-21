# CSP violation reporting: review package (migration 00023 and csp-report function)

Status (2026-11-21): **migration `00023` applied and `csp-report` deployed to production. `vercel.json` is unchanged and CSP stays `Content-Security-Policy-Report-Only`. No `report-uri` is configured yet, so no browser reports reach the function.** Enforcement is not part of this package.

- Migration `00023` applied as live version `20261121161512 csp_violation_reports`. Repo file SHA-256 prefix `8f0e6df0…`, rollback `178416f3…`. History: 23 migrations.
- `csp-report` deployed as v1, ACTIVE, `verify_jwt` false (function id `b543a6f8-82e2-47e5-9100-5a2bccdb1cd8`). Live source read back and matches the repo file.
- Read-only and rolled-back checks: RLS on; only policy is `csp_violation_reports_read_admin`; `authenticated` SELECT only; `service_role` INSERT and sequence USAGE only; `anon` no table or sequence rights; `purge_csp_violation_reports()` is `SECURITY DEFINER` with `search_path=pg_catalog, public`, not executable by `anon`, `authenticated` or `service_role`. A rolled-back probe inserted one 100-day-old and one current row as `service_role`, then purged: 1 removed, 1 kept. The probe rolled back; live reports are 0.
- **Not verified:** a live POST through the gateway. The sandbox cannot reach `supabase.co` (TLS fails). See the synthetic test below.

## Why

`vercel.json` sends a report-only CSP but names no `report-uri` or `report-to`. Violations can only be seen in a browser console. Enforcement cannot be judged safe without a central, queryable record of what the policy would block. You chose an Edge Function that writes to a protected table.

## What is prepared

| File | SHA-256 | Purpose |
| --- | --- | --- |
| `supabase/migrations/20261101000023_csp_violation_reports.sql` | `993a9de0…d9395` | Table `csp_violation_reports` with length checks, index on `received_at`, RLS on, and grants limited to service-role insert and admin read through RLS |
| `supabase/rollbacks/20261101000023_csp_violation_reports.sql` | `f61be88a…b4f5` | Revokes the service-role insert. Keeps stored reports, the policy and the index |
| `supabase/functions/csp-report/index.ts` | `cd34f4d2…973f` | Accepts CSP reports, sanitizes, and inserts with the service role |
| `supabase/config.toml` | — | `[functions.csp-report] verify_jwt = false` (browsers send reports without credentials) |
| `artifacts/itam/src/lib/csp-report-edge.test.ts` | — | 9 tests on the real function source with mocked fetch |
| `artifacts/itam/src/lib/full-schema.local.test.ts` (last block) | — | 3 tests on privileges, length constraints and rollback, run on PGlite with every migration in order |

The table shows the first and last characters of each SHA-256. Run `sha256sum` on the files to get the full values before approving.

## Function behaviour

- Accepts `application/csp-report`, `application/reports+json`, and `application/json`. Other types get 415.
- Bodies over 16 KB get 413. Invalid JSON gets 400. Only POST is accepted apart from the CORS preflight.
- Accepts the legacy `csp-report` shape and the Reporting API array shape. Other report types are ignored.
- Stores at most 20 reports per request. Each field is truncated to 500 characters, or 200 for directive names, or 20 for disposition, or 300 for user agent.
- **Strips query strings and fragments** from URLs. Document URLs can carry tokens and blocked URLs can carry personal data.
- **Never stores** `script-sample`, which can contain page content.
- Returns 204 to browsers in all accepted cases, including when there is nothing to store.
- If the insert fails, returns 503 with a generic message. Error details are not exposed.

## Table and privileges

- RLS on. Authenticated users have no insert, update or delete grant. Anonymous users have no access.
- `service_role` has INSERT and sequence USAGE only. It bypasses RLS in Supabase, which is intended for the function only.
- Active administrators can read through RLS (`get_my_role() = 'administrator'`).
- Length constraints stop oversize values even if written directly.
- Retention: **90 days**, as approved. `purge_csp_violation_reports()` deletes reports older than 90 days. It is **not scheduled**; a cron job needs its own approval.

## Rollback

The rollback revokes the service-role insert and drops the purge function. The function then gets 503 from the database and stops storing reports. Stored reports, the read policy and the index are kept. Dropping the table would delete collected reports and needs a separate retention decision. To roll back the function, delete `csp-report` from the project; if a purge job was scheduled, unschedule it first.

## Local verification

- `csp-report-edge.test.ts`: 9 tests. Covers method and content-type handling, size and JSON limits, no database call when nothing usable is in the body, legacy and Reporting API shapes, query-string stripping, `script-sample` never stored, count and length caps, out-of-range line numbers dropped, and generic 503 on insert failure. All pass.
- `full-schema.local.test.ts`: applies every migration in order. The three new CSP tests check that only the service role inserts, that admins read and other users do not, that `anon` and `authenticated` are denied, that length checks hold, and that the rollback revokes insert but keeps rows. All 28 tests pass.
- Not tested: the deployed function, the hosted gateway, real browser delivery of reports, and the hosted grants. The sandbox cannot reach `supabase.co`.

## Steps to take this live (each needs your approval)

1. Approve and apply migration `00023` to production as a new live version. Confirm the live name does not collide with an existing version.
2. ~~Approve and deploy `csp-report`~~ **Done 2026-11-21 (v1).** Still to do: a synthetic check through the gateway. Run this from a machine with internet access (not the sandbox). It writes one row tagged `synthetic.invalid`, which the 90-day purge will remove:

```
curl -sS -o /dev/null -w "%{http_code}\n" -X POST \
  -H 'content-type: application/csp-report' \
  --data '{"csp-report":{"document-uri":"https://synthetic.invalid/csp-test?token=x","blocked-uri":"https://synthetic.invalid/blocked#x","violated-directive":"script-src-elem","effective-directive":"script-src-elem","disposition":"report","line-number":1}}' \
  https://rkwxdqludtdzbpuftsvi.supabase.co/functions/v1/csp-report
```

Expected: `204`. Then a read-only check: one row with `document_uri` = `https://synthetic.invalid/csp-test` (query string removed). Report the result. No deletion is needed; the 90-day purge removes it later.
3. Change `vercel.json` to add `report-uri https://rkwxdqludtdzbpuftsvi.supabase.co/functions/v1/csp-report` to the report-only header. Keep it report-only. This needs a new frontend deployment and promotion approval.
4. Let reports collect for a period you choose. Review each distinct violation: is it a real problem, a browser extension, or an expected resource that the policy should allow?
5. Only then consider enforcement. That is a separate change to the header, which needs its own approval and rollback.

## Decisions needed

- Answered: retention is 90 days. Reports are readable by active administrators only.
- Open: whether `document-uri` should be stored at all, or only the origin and path. The function keeps the path and drops the query string and fragment. Confirm this is acceptable before step 3.
