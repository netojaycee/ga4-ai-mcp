import { accountDeps } from "@/server/connect/deps";
import { handleLogout } from "@/server/connect/account";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleLogout(req, accountDeps());
}
