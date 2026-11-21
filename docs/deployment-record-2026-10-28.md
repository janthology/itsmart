# Deployment record: 2026-10-28

Branch: `arena/fbb1e145-itsmart`. Frontend commit: `73bf9ff`. Edge Function source: `supabase/functions/change-password/index.ts`.

This record lists what changed outside Git on 2026-10-28, what was held back, and how to roll each change back. It is an inventory, not a backup.

## Changes made

| Target | Object | State | Scope confirmed by user |
| --- | --- | --- | --- |
| Supabase `DOST02-ITSMART` (`rkwxdqludtdzbpuftsvi`) | Edge Function `change-password` (id `9f58af79-c160-4b4c-a793-9446699c6dd8`) | ACTIVE, version 1, `verify_jwt` false. Body equals committed `index.ts`. | Keep live (user answer, 2026-10-28). Live behavior **not verified**; the sandbox cannot reach `supabase.co`. |
| Vercel `itsmart-dost02` | Preview deployment `dpl_9uP6zJDTksMkZkcaCbUzHFjmqjJX` from `73bf9ff` | READY, not promoted. Behind Vercel login. | Keep preview (user answer, 2026-10-28). |

## Held back (not deployed)

- **Production frontend promotion.** Production remains `dpl_F4exUtaVQX8WdTidmW93jC8DWMcw`. Held until the browser e2e suite runs and the live Edge path is verified (user answer, 2026-10-28).
- **Migration `20261101000022_profile_password_flag_guard.sql`.** Not applied. Must ship after the frontend change-password path is live. Applying it earlier blocks mandatory password changes for flagged accounts.
- Pre-existing functions `create-user` (v3) and `reset-password` (v4) were **not modified**. Whether their live code matches the repo is unverified.

## Rollback

- **Edge Function `change-password`:** delete the function `change-password` from `DOST02-ITSMART`. No other function depends on it. Nothing in production calls it until the frontend is promoted.
- **Vercel preview:** delete deployment `dpl_9uP6zJDTksMkZkcaCbUzHFjmqjJX`. Production is unaffected.
- **Migration `00022`:** not applied, so there is nothing to roll back yet. Once applied, its rollback is `supabase/rollbacks/20261101000022_profile_password_flag_guard.sql`. That restores direct `UPDATE` on `profiles` for `authenticated`. Use it only if the change-password path breaks.

## Known gaps

- Commit `fd0e44b` has the message "(not deployed)". The function is now live. The message was not rewritten, to avoid history rewrites.
- Unverified: GoTrue password grant for a flagged user; whether `logout?scope=global` revokes the verification session; whether the live `create-user` and `reset-password` code matches the repo.
- Browser e2e (`e2e/role-pages.spec.ts`) has not run. The Playwright browser download failed in the sandbox.

## Verification at `73bf9ff`

- `vitest run`: 29 files, 240 tests passing. Includes `change-password-edge.test.ts` (25) and `profile-password-flag-guard.local.test.ts` (6).
- `tsc --noEmit -p .`: exit 0.
- `vite build`: exit 0.
