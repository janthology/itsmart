# Intern test guide (unit and offline checks)

Status: prepared 2026-11-21 for the interns' unit-testing round. This guide covers only tests that run **offline**, plus the rules for the two kinds of test that touch a real system. It does not approve any production change or any data change.

## Before you start

- You need Node 22, and pnpm through Corepack (`corepack pnpm`). Do not use a global `pnpm` if it is missing from PATH.
- Work only in a fresh clone of the session branch. Do not commit `.env` files. Do not paste real keys, passwords or tokens into tests, logs or chat.
- Install from the repository root:

```
corepack pnpm install --frozen-lockfile
```

## 1. Offline checks (the same gates CI runs)

Run these from the repository root. They use no live Supabase project.

| Check | Command | What it covers |
| --- | --- | --- |
| Typecheck | `corepack pnpm --filter @workspace/itam run typecheck` | TypeScript for the app |
| Unit tests | `corepack pnpm --filter @workspace/itam run test` | About 250 Vitest tests, 30 files. Includes local PostgreSQL migration tests that use an in-memory database (PGlite) |
| Production build | `corepack pnpm --filter @workspace/itam run build` | Vite build |
| Bundle budget | `corepack pnpm --filter @workspace/itam run check:bundle` | Bundle size limit |

Expected on the current branch: all tests pass, the typecheck exits 0, and the build and bundle budget succeed. If a test fails, record the file name, test name and first error line. Do not change a test to make it pass without telling the reviewer.

Coverage (optional):

```
corepack pnpm --filter @workspace/itam run test:coverage
```

## 2. Browser smoke tests (Playwright, offline)

These run against the production build on `127.0.0.1:4173`, with a dummy Supabase client and synthetic data. They need a Chromium browser:

```
corepack pnpm --filter @workspace/itam exec playwright install chromium
corepack pnpm --filter @workspace/itam run test:e2e
```

If the browser download fails on your network, record the error and skip this step. It is not a code failure. Tell the reviewer, and do not work around it with a different production URL.

## 3. Destructive PostgreSQL tests: disposable local database only

`test:security:postgres` creates and drops roles and databases. **Never run it against Supabase, a shared development database, or any server that is not a new, temporary local cluster.** The script refuses to run unless these are set:

- `ITSMART_DISPOSABLE_PG=1`
- `ITSMART_TEST_PG_SOCKET` pointing to a temporary Unix socket in the system temp directory
- `ITSMART_TEST_PG_PORT` for that cluster

See `docs/security-remediation-stage-1.md` for the setup. If you are not sure the cluster is disposable, stop.

## 4. Signed-in tests: NOT for interns to run from this guide

Tests that sign in as real users, change passwords, or write business records are **not** part of this round. They follow `docs/user-operated-signed-in-test-plan.md`, which requires:

- dedicated test accounts, each named with the `[ITSMART TEST]` prefix, created and operated by the tester
- written approval of any synthetic records and their cleanup
- no use of the retained administrator account for tests
- the target project confirmed as `DOST02-ITSMART` before anything runs

Do not put account credentials in a repository file, a test, a screenshot or a chat message. Record only PASS or FAIL, the role, the build version, and a sanitized error.

## 5. What to report

For each run, record:

1. The commit you tested (`git rev-parse HEAD`).
2. Each command, and PASS or FAIL.
3. For a failure: the test file, test name, and first error line.
4. Anything you could not run, and why.

Send the report to the reviewer. Do not push fixes to the session branch without asking.

## Known limits

- The offline tests cannot prove hosted Supabase behavior, such as the live Auth session rules or the deployed Edge Functions. Those are covered only by the signed-in plan.
- Browser tests use a dummy Supabase client. They do not sign in.
- The password gate is **not** implemented yet. Tests for it exist only as prototypes and are not evidence that enforcement works.
