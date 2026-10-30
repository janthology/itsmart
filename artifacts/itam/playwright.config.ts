import { defineConfig } from "@playwright/test";

// Browser smoke tests against the production build (vite preview).
// They only cover flows that work signed-out — no credentials or live
// Supabase writes — so they can run in CI on every push:
//   1. the login page renders,
//   2. a protected route redirects signed-out visitors to /login,
//   3. /register redirects to /login (public signup is disabled).
// Role-based click-throughs stay in docs/smoke-test-checklist.md.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
  webServer: {
    command: "pnpm run serve",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
