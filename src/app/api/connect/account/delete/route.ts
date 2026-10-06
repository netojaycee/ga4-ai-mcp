import { accountDeps } from "@/server/connect/deps";
import { handleAccountAction } from "@/server/connect/account";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleAccountAction(req, accountDeps(), "delete");
}
