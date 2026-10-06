import { defaultDeps } from "@/server/oauth/deps";
import { corsPreflight } from "@/server/oauth/http";
import { handleRevoke } from "@/server/oauth/tokens";

export const POST = (req: Request) => handleRevoke(defaultDeps(), req);
export const OPTIONS = () => corsPreflight();
