import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ReminderStore } from "../reminders/store.js";

export function registerReminderCancelTool(server: McpServer, deps: { store: ReminderStore }): void {
  server.registerTool(
    "reminder_cancel",
    {
      title: "Cancel Reminder",
      description: "取消我创建的提醒（通过提醒ID前缀）",
      inputSchema: {
        user_id: z.string().min(1),
        reminder_id: z.string().min(1)
      }
    },
    async (args: any) => {
      const userId = String(args.user_id);
      const reminderId = String(args.reminder_id).trim();
      const rem = deps.store.cancel({ userId }, reminderId);
      if (!rem) return { content: [{ type: "text", text: "未找到要取消的提醒（请提供提醒ID）" }] };
      return { content: [{ type: "text", text: rem.status === "canceled" ? "已取消提醒" : "该提醒已不是待执行状态" }] };
    }
  );
}

