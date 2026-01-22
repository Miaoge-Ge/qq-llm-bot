import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { logger } from "../logger.js";
import { resolveFromProjectRoot } from "../utils/fs.js";

export type McpTool = {
  server: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
};

const serverConfigSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  tools: z.record(z.boolean()).optional()
});

const registrySchema = z.object({
  servers: z.array(serverConfigSchema).default([])
});

export class McpRegistry {
  private clients = new Map<string, Client>();
  private tools: McpTool[] = [];

  async connectAll(configPath = "mcp.servers.json"): Promise<void> {
    const abs = resolveFromProjectRoot(configPath);
    if (!fs.existsSync(abs)) {
      logger.info({ configPath: abs }, "MCP config not found, skip");
      return;
    }

    const raw = fs.readFileSync(abs, "utf8");
    const parsed = registrySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error("MCP 配置文件格式错误");

    for (const s of parsed.data.servers.filter((x) => x.enabled)) {
      try {
        await this.connectServer(s);
      } catch (err) {
        logger.error({ err, server: s.name }, "Failed to connect to MCP server");
      }
    }
  }

  listTools(): McpTool[] {
    return [...this.tools];
  }

  async callTool(opts: { server: string; name: string; arguments: Record<string, unknown> }): Promise<string> {
    const client = this.clients.get(opts.server);
    if (!client) throw new Error(`MCP server not connected: ${opts.server}`);
    const enabled = this.tools.some((t) => t.server === opts.server && t.name === opts.name);
    if (!enabled) throw new Error(`MCP tool not found or disabled: ${opts.server}::${opts.name}`);
    const res = await client.callTool({ name: opts.name, arguments: opts.arguments });
    const parts = (res as any)?.content as any[] | undefined;
    const texts = (parts ?? [])
      .map((p) => {
        if (!p || typeof p !== "object") return String(p ?? "");
        if (p.type === "text") return String(p.text ?? "");
        if (p.type === "json") {
          try {
            return JSON.stringify(p.json ?? null);
          } catch {
            return String(p.json ?? "");
          }
        }
        try {
          return JSON.stringify(p);
        } catch {
          return String(p);
        }
      })
      .filter(Boolean);
    return texts.join("\n").trim();
  }

  private async connectServer(s: z.infer<typeof serverConfigSchema>): Promise<void> {
    const transport = new StdioClientTransport({ command: s.command, args: s.args });
    const client = new Client({ name: "qq-llm-bot", version: "0.1.0" });
    await client.connect(transport);

    this.clients.set(s.name, client);

    const listed = await client.listTools();
    const mapped: McpTool[] = (listed.tools ?? []).map((t: any) => ({
      server: s.name,
      name: String(t.name),
      description: typeof t.description === "string" ? t.description : undefined,
      inputSchema: t.inputSchema
    }));
    const filtered = filterMcpTools(mapped, s.tools);
    this.tools.push(...filtered);
    logger.info({ server: s.name, toolCount: mapped.length }, "MCP server connected");
  }
}

export function filterMcpTools(tools: McpTool[], config: Record<string, boolean> | undefined): McpTool[] {
  if (!config) return tools;
  const values = Object.values(config);
  const hasAllowList = values.some((v) => v === true);
  if (hasAllowList) return tools.filter((t) => config[t.name] === true);
  return tools.filter((t) => config[t.name] !== false);
}
