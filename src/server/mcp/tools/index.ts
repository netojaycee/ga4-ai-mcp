import { accountStatusTool } from "./account";
import { GOOGLE_TOOLS } from "./google";
import type { ToolDefinition } from "./types";

/** Add new tools here. Each one runs through runTool. */
export const TOOLS: ToolDefinition[] = [accountStatusTool, ...GOOGLE_TOOLS];

export type { ToolDefinition } from "./types";
export { defineTool } from "./types";
