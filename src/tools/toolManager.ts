import { ZodError } from "zod";
import type { AppConfig } from "../config.js";
import type { ChatEvent } from "../types.js";
import type { McpRegistry } from "../mcp/registry.js";
import { builtinTools } from "./builtins.js";
import type { ToolCatalogItem, ToolContext, ToolDefinition } from "./types.js";
import { isPlainObject, withTimeout } from "../utils/async.js";

type JsonSchema =
  | {
      type?: string;
      properties?: Record<string, JsonSchema>;
      required?: string[];
      additionalProperties?: boolean;
      items?: JsonSchema;
    }
  | Record<string, unknown>
  | unknown;

export class ToolManager {
  private readonly builtins: ToolDefinition[];

  constructor(
    private readonly config: AppConfig,
    private readonly mcp: McpRegistry
  ) {
    this.builtins = builtinTools();
  }

  listCatalog(): ToolCatalogItem[] {
    const builtins: ToolCatalogItem[] = this.builtins.map((t) => ({ name: t.name, description: t.description }));
    const mcp: ToolCatalogItem[] = this.mcp
      .listTools()
      .map((t) => ({ name: `${t.server}::${t.name}`, description: t.description ?? "", inputSchema: t.inputSchema }))
      .filter((t) => t.name && t.description);
    return [...builtins, ...mcp];
  }

  async execute(toolName: string, args: unknown, ctx: { evt: ChatEvent }): Promise<string> {
    if (!toolName) throw new Error("工具名不合法");

    const tool = this.builtins.find((t) => t.name === toolName);
    if (tool) return this.executeBuiltin(tool, args, ctx);

    const m = toolName.match(/^([^:]+)::(.+)$/);
    if (m) return this.executeMcp({ server: m[1], name: m[2], arguments: args }, ctx);

    const matched = this.mcp.listTools().filter((t) => t.name === toolName);
    if (matched.length === 1) {
      return this.executeMcp({ server: matched[0].server, name: matched[0].name, arguments: args }, ctx);
    }
    throw new Error("工具名不合法");
  }

  private async executeBuiltin(tool: ToolDefinition, args: unknown, ctx: { evt: ChatEvent }): Promise<string> {
    let parsedArgs: unknown = args;
    if (tool.input) {
      if (!isPlainObject(args)) throw new Error("参数错误：arguments 必须是对象");
      try {
        parsedArgs = tool.input.parse(args);
      } catch (e) {
        if (e instanceof ZodError) throw new Error(`参数错误：${e.issues[0]?.message ?? "格式不正确"}`);
        throw e;
      }
    }
    const timeoutMs = Number(tool.timeoutMs ?? this.config.TOOL_TIMEOUT_MS ?? 15000);
    const context: ToolContext = { evt: ctx.evt, config: this.config };
    return withTimeout(tool.run(parsedArgs, context), timeoutMs, `tool ${tool.name}`);
  }

  private async executeMcp(
    opts: { server: string; name: string; arguments: unknown },
    ctx: { evt: ChatEvent }
  ): Promise<string> {
    const tool = this.mcp.listTools().find((t) => t.server === opts.server && t.name === opts.name);
    if (!tool) throw new Error(`MCP tool not found or disabled: ${opts.server}::${opts.name}`);
    const enrichedArgs = enrichMcpArguments(opts.name, opts.arguments, ctx.evt);
    const checkedArgs = validateArgsAgainstJsonSchema(tool.inputSchema as JsonSchema, enrichedArgs);
    if (!checkedArgs.ok) throw new Error(`参数错误：${checkedArgs.error}`);
    const baseTimeoutMs = Number(this.config.TOOL_TIMEOUT_MS ?? 15000);
    const timeoutMs = opts.name === "vision_describe" ? Math.max(baseTimeoutMs, 45_000) : baseTimeoutMs;
    return withTimeout(
      this.mcp.callTool({ server: opts.server, name: opts.name, arguments: checkedArgs.value }),
      timeoutMs,
      `mcp ${opts.server}::${opts.name}`
    );
  }
}

function enrichMcpArguments(toolName: string, args: unknown, evt: ChatEvent): unknown {
  const name = String(toolName ?? "").trim();
  if (!isPlainObject(args ?? {})) return args;
  if (!name.startsWith("reminder_")) return args;
  const obj = { ...(args as Record<string, unknown>) };

  if (typeof obj.chat_type !== "string" || !String(obj.chat_type).trim()) obj.chat_type = evt.chatType;
  if (typeof obj.user_id !== "string" || !String(obj.user_id).trim()) obj.user_id = evt.userId;
  if (typeof obj.message_id !== "string" || !String(obj.message_id).trim()) obj.message_id = evt.messageId;
  if (typeof obj.now_ms !== "number" || !Number.isFinite(obj.now_ms)) obj.now_ms = evt.timestampMs || Date.now();
  if (evt.chatType === "group" && evt.groupId) {
    if (typeof obj.group_id !== "string" || !String(obj.group_id).trim()) obj.group_id = evt.groupId;
  }
  return obj;
}

function validateArgsAgainstJsonSchema(schema: JsonSchema, args: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!schema || typeof schema !== "object") {
    if (!isPlainObject(args ?? {})) return { ok: false, error: "arguments 必须是对象" };
    return { ok: true, value: (args ?? {}) as Record<string, unknown> };
  }

  const type = typeof (schema as any).type === "string" ? String((schema as any).type) : undefined;
  if (type && type !== "object") {
    if (!isPlainObject(args ?? {})) return { ok: false, error: "arguments 必须是对象" };
    return { ok: true, value: (args ?? {}) as Record<string, unknown> };
  }

  if (!isPlainObject(args ?? {})) return { ok: false, error: "arguments 必须是对象" };
  const obj = (args ?? {}) as Record<string, unknown>;

  const required = Array.isArray((schema as any).required) ? ((schema as any).required as unknown[]).map(String) : [];
  for (const k of required) {
    if (!(k in obj)) return { ok: false, error: `缺少必填字段：${k}` };
  }

  const props = isPlainObject((schema as any).properties) ? ((schema as any).properties as Record<string, unknown>) : undefined;
  if (props) {
    for (const [k, sub] of Object.entries(props)) {
      if (!(k in obj)) continue;
      const ok = validateValueAgainstSchema(sub as JsonSchema, obj[k]);
      if (!ok.ok) return { ok: false, error: `字段 ${k}：${ok.error}` };
    }
  }

  const ap = (schema as any).additionalProperties;
  if (ap === false && props) {
    const allowed = new Set(Object.keys(props));
    for (const k of Object.keys(obj)) {
      if (!allowed.has(k)) return { ok: false, error: `不允许的字段：${k}` };
    }
  }

  return { ok: true, value: obj };
}

function validateValueAgainstSchema(schema: JsonSchema, v: unknown): { ok: true } | { ok: false; error: string } {
  if (!schema || typeof schema !== "object") return { ok: true };
  const type = typeof (schema as any).type === "string" ? String((schema as any).type) : undefined;
  if (!type) return { ok: true };
  if (type === "string") return typeof v === "string" ? { ok: true } : { ok: false, error: "应为字符串" };
  if (type === "number") return typeof v === "number" && Number.isFinite(v) ? { ok: true } : { ok: false, error: "应为数字" };
  if (type === "integer") return typeof v === "number" && Number.isInteger(v) ? { ok: true } : { ok: false, error: "应为整数" };
  if (type === "boolean") return typeof v === "boolean" ? { ok: true } : { ok: false, error: "应为布尔值" };
  if (type === "array") {
    if (!Array.isArray(v)) return { ok: false, error: "应为数组" };
    const items = (schema as any).items as JsonSchema | undefined;
    if (!items) return { ok: true };
    for (const item of v) {
      const r = validateValueAgainstSchema(items, item);
      if (!r.ok) return { ok: false, error: `数组元素${r.error ? `：${r.error}` : ""}` };
    }
    return { ok: true };
  }
  if (type === "object") return isPlainObject(v) ? { ok: true } : { ok: false, error: "应为对象" };
  return { ok: true };
}
