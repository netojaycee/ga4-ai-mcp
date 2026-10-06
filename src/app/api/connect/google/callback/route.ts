import { connectDeps } from "@/server/connect/deps";
import { handleCallback } from "@/server/connect/flow";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handleCallback(req, connectDeps());
}
