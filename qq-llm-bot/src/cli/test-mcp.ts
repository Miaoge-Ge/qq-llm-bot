import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/mcp/servers/local-time.js"] });
const client = new Client({ name: "qq-llm-bot-mcp-test", version: "0.1.0" });

await client.connect(transport);
const tools = await client.listTools();
console.log("tools:", tools.tools?.map((t: any) => t.name));

const res = await client.callTool({ name: "now", arguments: {} });
const text = (res as any)?.content?.find((p: any) => p?.type === "text")?.text;
console.log("now:", text);

process.exit(0);

