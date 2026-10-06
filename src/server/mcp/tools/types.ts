import type { z, ZodRawShape } from "zod";
import type { ToolContext, ToolOutput } from "../wrapper";

export interface ToolDefinition {
  name: string;
  title: string;
  /** Written for LLMs: say what it returns and when to use it. */
  description: string;
  inputSchema: ZodRawShape;
  handler: (args: never, tc: ToolContext) => Promise<ToolOutput>;
}

/** Typed helper so `args` is inferred from the Zod shape. All tools are read-only. */
export function defineTool<S extends ZodRawShape>(def: {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  handler: (args: z.infer<z.ZodObject<S>>, tc: ToolContext) => Promise<ToolOutput>;
}): ToolDefinition {
  return def as unknown as ToolDefinition;
}
