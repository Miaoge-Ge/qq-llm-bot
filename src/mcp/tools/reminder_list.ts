import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ReminderStore } from "../reminders/store.js";

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

export function registerReminderListTool(server: McpServer, deps: { store: ReminderStore }): void {
  server.registerTool(
    "reminder_list",
    {
      title: "List Reminders",
      description: "列出我创建的待执行提醒",
      inputSchema: {
        chat_type: z.enum(["private", "group"]),
        user_id: z.string().min(1),
        group_id: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(20).optional().default(10)
      }
    },
    async (args: any) => {
      const chatType = String(args.chat_type);
      const userId = String(args.user_id);
      const groupId = args.group_id ? String(args.group_id) : undefined;
      const limit = Number(args.limit ?? 10);
      const list = deps.store.listPendingByCreator({ userId, chatType: chatType === "group" ? "group" : "private", groupId });
      if (!list.length) return { content: [{ type: "text", text: "暂无待提醒事项" }] };
      const lines = list
        .slice(0, limit)
        .map((r, i) => `${i + 1}. ${fmtTime(r.dueAtMs)}：${r.text}（${r.id.slice(0, 8)}）`);
      return { content: [{ type: "text", text: `待提醒：\n${lines.join("\n")}` }] };
    }
  );
}

