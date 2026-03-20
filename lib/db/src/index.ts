import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

function getConnectionConfig(): { connectionString?: string; host?: string; port?: number; user?: string; password?: string; database?: string; ssl?: any } {
  const supabasePassword = process.env.SUPABASE_DATABASE_URL;
  const supabaseHost = process.env.SUPABASE_HOST;

  if (supabasePassword && supabaseHost) {
    // SUPABASE_DATABASE_URL contains the password, build connection from parts
    return {
      host: supabaseHost,
      port: parseInt(process.env.SUPABASE_DB_PORT ?? "5432"),
      user: process.env.SUPABASE_DB_USER ?? "postgres",
      password: supabasePassword,
      database: process.env.SUPABASE_DB_NAME ?? "postgres",
      ssl: { rejectUnauthorized: false },
    };
  }

  if (supabasePassword && (supabasePassword.startsWith("postgresql://") || supabasePassword.startsWith("postgres://"))) {
    // SUPABASE_DATABASE_URL is a full connection URL
    return {
      connectionString: supabasePassword,
      ssl: { rejectUnauthorized: false },
    };
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "SUPABASE_DATABASE_URL or DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }

  return { connectionString: databaseUrl };
}

const config = getConnectionConfig();
export const pool = new Pool(config);
export const db = drizzle(pool, { schema });

export * from "./schema";
