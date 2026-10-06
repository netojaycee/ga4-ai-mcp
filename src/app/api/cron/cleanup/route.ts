import { env } from "@/config/env";
import { checkCronAuth } from "@/server/mail/trial-notices";
import { drizzleCleanupStore, runCleanup } from "@/server/maintenance/cleanup";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = checkCronAuth(request.headers.get("authorization"), env().CRON_SECRET);
  if (auth === "unconfigured") return Response.json({ error: "cron_not_configured" }, { status: 503, headers });
  if (auth === "unauthorized") return Response.json({ error: "unauthorized" }, { status: 401, headers });
  try {
    return Response.json({ ok: true, ...(await runCleanup(drizzleCleanupStore(), new Date())) }, { headers });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500, headers });
  }
}
