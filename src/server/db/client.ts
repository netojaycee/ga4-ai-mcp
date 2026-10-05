import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/config/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __pgPool?: Pool };

/** Lazy so importing this module never needs env at build time. */
export function db() {
  const pool = (globalForDb.__pgPool ??= new Pool({ connectionString: env().DATABASE_URL, max: 5 }));
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof db>;
