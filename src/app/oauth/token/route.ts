import { defaultDeps } from "@/server/oauth/deps";
import { corsPreflight } from "@/server/oauth/http";
import { handleToken } from "@/server/oauth/tokens";

export const POST = (req: Request) => handleToken(defaultDeps(), req);
export const OPTIONS = () => corsPreflight();
