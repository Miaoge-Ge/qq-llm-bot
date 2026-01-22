import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerNowTool(server: McpServer): void {
  server.registerTool(
    "now",
    {
      title: "Get Local Time",
      description: "Get current local time in ISO and locale string formats",
      inputSchema: { tz: z.string().optional() }
    },
    async () => {
      const d = new Date();
      return { content: [{ type: "text", text: JSON.stringify({ iso: d.toISOString(), locale: d.toLocaleString() }, null, 2) }] };
    }
  );
}

