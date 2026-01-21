import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "local-time", version: "0.1.0" });

server.registerTool(
  "now",
  {
    title: "Get Local Time",
    description: "Get current local time in ISO and locale string formats",
    inputSchema: { tz: z.string().optional() }
  },
  async () => {
    const d = new Date();
    return {
      content: [
        { type: "text", text: JSON.stringify({ iso: d.toISOString(), locale: d.toLocaleString() }, null, 2) }
      ]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

