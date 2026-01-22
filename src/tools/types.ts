import type { ZodTypeAny } from "zod";
import type { AppConfig } from "../config.js";
import type { ChatEvent } from "../types.js";

export type ToolContext = {
  evt: ChatEvent;
  config: AppConfig;
};

export type ToolDefinition = {
  name: string;
  description: string;
  input?: ZodTypeAny;
  timeoutMs?: number;
  run: (args: unknown, ctx: ToolContext) => Promise<string>;
};

export type ToolCatalogItem = {
  name: string;
  description: string;
  inputSchema?: unknown;
};
