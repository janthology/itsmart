import { defineConfig } from "drizzle-kit";
import path from "path";

function getDbUrl(): string {
  const supabasePassword = process.env.SUPABASE_DATABASE_URL;
  const supabaseHost = process.env.SUPABASE_HOST;

  if (supabasePassword && supabaseHost) {
    const user = encodeURIComponent(process.env.SUPABASE_DB_USER ?? "postgres");
    const password = encodeURIComponent(supabasePassword);
    const port = process.env.SUPABASE_DB_PORT ?? "5432";
    const database = process.env.SUPABASE_DB_NAME ?? "postgres";
    return `postgresql://${user}:${password}@${supabaseHost}:${port}/${database}?sslmode=require`;
  }

  if (supabasePassword && (supabasePassword.startsWith("postgresql://") || supabasePassword.startsWith("postgres://"))) {
    return supabasePassword;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("SUPABASE_DATABASE_URL or DATABASE_URL must be set");
  return url;
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: getDbUrl(),
  },
});
