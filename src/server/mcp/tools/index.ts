import { accountStatusTool } from "./account";
import type { ToolDefinition } from "./types";

/** Add new tools here (GA4/GSC tools are registered by task 3.3). Each one runs through runTool. */
export const TOOLS: ToolDefinition[] = [accountStatusTool];

export type { ToolDefinition } from "./types";
export { defineTool } from "./types";
