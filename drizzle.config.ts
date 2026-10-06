import { defineConfig } from "drizzle-kit";

/**
 * Dev by default. Production is an explicit opt-in: `npm run db:migrate:prod` (DB_TARGET=prod).
 * loadEnvFile never overrides variables that are already set, so the first file listed wins.
 */
const target = process.env.DB_TARGET === "prod" ? "prod" : "dev";
const files = target === "prod" ? [".env.local"] : [".env.development.local", ".env.local"];
for (const f of files) {
  try {
    process.loadEnvFile(f);
  } catch {
    // file missing: CI/Vercel provide env directly
  }
}

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
let host = "(no database url)";
try {
  host = new URL(url).host;
} catch {}
console.log(`[drizzle] target=${target} host=${host}`);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
