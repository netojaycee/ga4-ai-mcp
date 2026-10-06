import { defaultDeps } from "@/server/oauth/deps";
import { corsPreflight } from "@/server/oauth/http";
import { handleRegister } from "@/server/oauth/register";

export const POST = (req: Request) => handleRegister(defaultDeps(), req);
export const OPTIONS = () => corsPreflight();
