import { connectDeps } from "@/server/connect/deps";
import { handleStart } from "@/server/connect/flow";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handleStart(req, connectDeps());
}
