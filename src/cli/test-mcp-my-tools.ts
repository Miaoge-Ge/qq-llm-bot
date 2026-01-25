import "dotenv/config";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const preferredPython = "/opt/MCP/.venv/bin/python";
const pythonCmd = fs.existsSync(preferredPython) ? preferredPython : "python3";
const transport = new StdioClientTransport({ command: pythonCmd, args: ["/opt/MCP/server.py"] });
const client = new Client({ name: "qq-llm-bot-mcp-test-my-tools", version: "0.1.0" });

await client.connect(transport);
const tools = await client.listTools();
console.log("tools:", tools.tools?.map((t: any) => t.name));

const model = await client.callTool({ name: "get_model_name", arguments: {} });
console.log("get_model_name:", (model as any)?.content?.[0]?.text);

const date = await client.callTool({ name: "get_date", arguments: {} });
console.log("get_date:", (date as any)?.content?.[0]?.text);

const weather = await client.callTool({ name: "weather_query", arguments: { location: "北京" } });
console.log("weather_query:", (weather as any)?.content?.[0]?.text);

const search = await client.callTool({ name: "web_search", arguments: { query: "NapCatQQ OneBot" } });
console.log("web_search:", (search as any)?.content?.[0]?.text);

const fileSave = await client.callTool({
  name: "file_save",
  arguments: {
    files: [
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/af3WQAAAABJRU5ErkJggg=="
    ],
    filename_prefix: "test"
  }
});
console.log("file_save:", (fileSave as any)?.content?.[0]?.text);

process.exit(0);
