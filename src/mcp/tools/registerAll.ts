import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../../config.js";
import type { OpenAiCompatClient } from "../../llm/openaiCompat.js";
import type { ReminderStore } from "../reminders/store.js";
import { registerNowTool } from "./now.js";
import { registerGetModelNameTool } from "./get_model_name.js";
import { registerGetDateTool } from "./get_date.js";
import { registerWeatherQueryTool } from "./weather_query.js";
import { registerWebSearchTool } from "./web_search.js";
import { registerReminderCreateTool } from "./reminder_create.js";
import { registerReminderListTool } from "./reminder_list.js";
import { registerReminderCancelTool } from "./reminder_cancel.js";

export function registerAllTools(server: McpServer, deps: { config: AppConfig; llm: OpenAiCompatClient; reminderStore: ReminderStore }): void {
  registerNowTool(server);
  registerGetModelNameTool(server);
  registerGetDateTool(server);
  registerWeatherQueryTool(server);
  registerWebSearchTool(server);
  registerReminderCreateTool(server, { store: deps.reminderStore });
  registerReminderListTool(server, { store: deps.reminderStore });
  registerReminderCancelTool(server, { store: deps.reminderStore });
}
