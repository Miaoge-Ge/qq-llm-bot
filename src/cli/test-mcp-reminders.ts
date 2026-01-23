import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "python3", args: ["/opt/MCP/server.py"] });
const client = new Client({ name: "qq-llm-bot-mcp-test-reminders", version: "0.1.0" });

await client.connect(transport);
const tools = await client.listTools();
console.log("tools:", tools.tools?.map((t: any) => t.name));

const create = await client.callTool({
  name: "reminder_create",
  arguments: {
    chat_type: "group",
    user_id: "u1",
    group_id: "g1",
    request: "@123456 1小时后提醒@123456 开会",
    now_ms: Date.now()
  }
});
console.log("reminder_create:", (create as any)?.content?.[0]?.text);

const create2 = await client.callTool({
  name: "reminder_create",
  arguments: {
    chat_type: "private",
    user_id: "u2",
    request: "半个小时之后提醒我去剪头发",
    now_ms: Date.now()
  }
});
console.log("reminder_create_2:", (create2 as any)?.content?.[0]?.text);

const list = await client.callTool({
  name: "reminder_list",
  arguments: { chat_type: "group", user_id: "u1", group_id: "g1", limit: 5 }
});
const listText = String((list as any)?.content?.[0]?.text ?? "");
console.log("reminder_list:", listText);

const id = listText.match(/\（([0-9a-f]{8})\）/)?.[1];
if (id) {
  const cancel = await client.callTool({ name: "reminder_cancel", arguments: { user_id: "u1", reminder_id: id } });
  console.log("reminder_cancel:", (cancel as any)?.content?.[0]?.text);
}

process.exit(0);
