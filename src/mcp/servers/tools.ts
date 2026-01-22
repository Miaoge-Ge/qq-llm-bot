import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../../config.js";
import { OpenAiCompatClient } from "../../llm/openaiCompat.js";
import { registerAllTools } from "../tools/registerAll.js";
import { ReminderStore } from "../reminders/store.js";
import { NapCatHttpSender } from "../reminders/napcatHttp.js";
import { ReminderSchedulerService } from "../reminders/scheduler.js";

const config = loadConfig();
const llm = new OpenAiCompatClient(config.LLM_BASE_URL, config.LLM_API_KEY);

const reminderStore = new ReminderStore(config);
const sender = new NapCatHttpSender(config);

const server = new McpServer({ name: "tools", version: "0.1.0" });
registerAllTools(server, { config, llm, reminderStore });

const scheduler = new ReminderSchedulerService(config, llm, reminderStore, sender);
scheduler.start();

const transport = new StdioServerTransport();
await server.connect(transport);

