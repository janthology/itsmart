import { defineConfig } from "vitest/config";
import path from "path";

// Unit tests for pure logic only (SLA math, escaping, lifecycle helpers).
// Dummy Supabase env values let modules that transitively import the
// client be loaded without network access — no test calls the API.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    env: {
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
    },
  },
});
