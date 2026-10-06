import { env } from "@/config/env";
import { checkCronAuth, drizzleNoticeDeps, runTrialNotices } from "@/server/mail/trial-notices";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = checkCronAuth(request.headers.get("authorization"), env().CRON_SECRET);
  if (auth === "unconfigured") return Response.json({ error: "cron_not_configured" }, { status: 503, headers });
  if (auth === "unauthorized") return Response.json({ error: "unauthorized" }, { status: 401, headers });
  try {
    const summary = await runTrialNotices(drizzleNoticeDeps());
    return Response.json({ ok: true, ...summary }, { headers });
  } catch {
    // No error detail: it could contain connection strings or addresses.
    return Response.json({ error: "internal_error" }, { status: 500, headers });
  }
}
