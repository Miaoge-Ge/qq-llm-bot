import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { logger } from "../logger.js";
import { resolveFromCwd } from "../utils/fs.js";

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
    const abs = resolveFromCwd(configPath);
    if (!fs.existsSync(abs)) {
      logger.info({ configPath: abs }, "MCP config not found, skip");
      return;
    }

    const raw = fs.readFileSync(abs, "utf8");
    const parsed = registrySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error("MCP 配置文件格式错误");

    for (const s of parsed.data.servers.filter((x) => x.enabled)) {
      await this.connectServer(s);
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
    const texts = (parts ?? []).map((p) => (p?.type === "text" ? String(p.text ?? "") : "")).filter(Boolean);
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
    const filtered = s.tools
      ? mapped.filter((t) => {
          const v = s.tools?.[t.name];
          return v !== false;
        })
      : mapped;
    this.tools.push(...filtered);
    logger.info({ server: s.name, toolCount: mapped.length }, "MCP server connected");
  }
}

