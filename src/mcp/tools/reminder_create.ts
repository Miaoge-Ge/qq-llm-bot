import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ReminderStore } from "../reminders/store.js";
import { isSelfReminderRequest, pickMentionUserIdForReminderRequest, parseReminderRequests } from "../reminders/parser.js";

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

function fmtHm(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatMention(mentionUserId: string | undefined): string | undefined {
  const id = String(mentionUserId ?? "").trim();
  if (!id) return undefined;
  return `[CQ:at,qq=${id}]`;
}

export function registerReminderCreateTool(server: McpServer, deps: { store: ReminderStore }): void {
  server.registerTool(
    "reminder_create",
    {
      title: "Create Reminder",
      description: "创建一个定时提醒（支持“1分钟后提醒我/在20:30提醒我/2026-01-23 09:00提醒我”等）",
      inputSchema: {
        chat_type: z.enum(["private", "group"]),
        user_id: z.string().min(1),
        group_id: z.string().optional(),
        message_id: z.string().optional(),
        request: z.string().min(1),
        mention_user_id: z.string().optional(),
        now_ms: z.coerce.number().int().optional()
      }
    },
    async (args: any) => {
      const chatType = String(args.chat_type);
      const userId = String(args.user_id);
      const groupId = args.group_id ? String(args.group_id) : undefined;
      const messageId = args.message_id ? String(args.message_id) : undefined;
      const request = String(args.request ?? "").trim();
      const nowMs = Number.isFinite(Number(args.now_ms)) ? Number(args.now_ms) : Date.now();

      const parsedList = parseReminderRequests(request, nowMs);
      if (!parsedList || !parsedList.length) {
        return { content: [{ type: "text", text: "我没看懂提醒时间。你可以这样说：1分钟后提醒我 喝水 / 在20:30提醒我 下楼拿快递" }] };
      }

      const wantsSelf = isSelfReminderRequest(request);
      const mentionFromText = pickMentionUserIdForReminderRequest(request);
      const mentionUserId =
        String(args.mention_user_id ?? (wantsSelf ? userId : mentionFromText) ?? (chatType === "group" ? userId : "")).trim() || undefined;

      const target = chatType === "private" ? { chatType: "private" as const, userId } : { chatType: "group" as const, groupId: groupId ?? "unknown" };

      const created = parsedList.map((p) =>
        deps.store.create({
          sourceMessageId: messageId,
          dueAtMs: p.dueAtMs,
          creatorUserId: userId,
          creatorChatType: chatType === "group" ? "group" : "private",
          creatorGroupId: groupId,
          target,
          mentionUserId: chatType === "group" ? mentionUserId : undefined,
          text: p.message
        })
      );

      if (created.length >= 2) {
        const times = created.map((r) => fmtHm(r.dueAtMs)).join("、");
        const prefix = chatType === "group" ? `${formatMention(userId)} ` : "";
        const who = chatType === "group" && mentionUserId && mentionUserId !== userId ? `，目标QQ：${mentionUserId}` : "";
        return { content: [{ type: "text", text: `${prefix}已设置 ${created.length} 个提醒：${times}${who}，内容：${created[0]!.text}`.trim() }] };
      }

      const rem = created[0]!;
      const prefix = chatType === "group" ? `${formatMention(userId)} ` : "";
      const who = chatType === "group" && mentionUserId && mentionUserId !== userId ? `，目标QQ：${mentionUserId}` : "";
      return { content: [{ type: "text", text: `${prefix}已设置提醒：${fmtTime(rem.dueAtMs)}${who}，内容：${rem.text}`.trim() }] };
    }
  );
}
