import { accountDeps } from "@/server/connect/deps";
import { disconnectUser } from "@/server/connect/account";
import { drizzleAdminUsersRepo, drizzleAudit } from "./repos";
import type { UserActionDeps } from "./users";

/** Production wiring for admin user actions. Called per request so env() is never read at import time. */
export function userActionDeps(): UserActionDeps {
  return {
    repo: drizzleAdminUsersRepo(),
    audit: drizzleAudit,
    now: () => new Date(),
    disconnect: (userId, actor) => disconnectUser(accountDeps(), userId, "admin.user.google_disconnected", actor),
  };
}
