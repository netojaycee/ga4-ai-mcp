import { handleAuthorizeGet, handleAuthorizePost } from "@/server/oauth/authorize";
import { defaultDeps } from "@/server/oauth/deps";

export const GET = (req: Request) => handleAuthorizeGet(defaultDeps(), req);
export const POST = (req: Request) => handleAuthorizePost(defaultDeps(), req);
