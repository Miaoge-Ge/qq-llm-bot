import type { ChatEvent, SendTarget } from "../types.js";
import type { McpRegistry } from "../mcp/registry.js";
import type { NoteStore } from "./noteStore.js";
import { parseReminderRequests } from "../mcp/reminders/parser.js";
import type { StatsStore } from "../stats/store.js";
import { formatDateLocal } from "../stats/store.js";
import { limitChatText, sanitizeChatText } from "../utils/text.js";

// Regex Constants
const REGEX_DATE = /(今天|今日).{0,6}(几月几号|几号|日期|星期)|(?:^今天是几号$)|(?:^几号$)/;
const REGEX_WEATHER = /天气/;
const REGEX_NEWS = /新闻|热搜|大事/;
const REGEX_NOTE_ADD = /^(?:记(?:一下)?|写)(?:个)?笔记[:：\s]+(.+)$/;
const REGEX_NOTE_REMOVE = /^(?:删除|移除)笔记\s+(.+)$/;
const REGEX_REMINDER_CANCEL = /^(?:取消|删除)提醒\s+(.+)$/;

export type CommandResult = { handled: true; replyText: string } | { handled: false };

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function parseNoteAdd(text: string): string | null {
  const m = text.trim().match(REGEX_NOTE_ADD);
  if (!m) return null;
  return m[1].trim() || null;
}

function isNoteList(text: string): boolean {
  const t = text.trim();
  return ["查看笔记", "我的笔记", "笔记列表", "列出笔记"].includes(t);
}

function parseNoteRemove(text: string): string | null {
  const m = text.trim().match(REGEX_NOTE_REMOVE);
  if (!m) return null;
  return m[1].trim() || null;
}

function isReminderList(text: string): boolean {
  const t = text.trim();
  return ["查看提醒", "我的提醒", "提醒列表", "列出提醒"].includes(t);
}

function parseReminderCancel(text: string): string | null {
  const m = text.trim().match(REGEX_REMINDER_CANCEL);
  if (!m) return null;
  return m[1].trim() || null;
}

function formatDateReplyFromToolOutput(raw: string): string | null {
  const s0 = String(raw ?? "").trim();
  if (!s0) return null;

  const tryParse = (s: string): any | null => {
    try {
      const v = JSON.parse(s);
      if (v && typeof v === "object") return v;
      return null;
    } catch {
      return null;
    }
  };

  const cleaned = sanitizeChatText(s0);
  const obj = tryParse(s0) ?? tryParse(cleaned);
  if (!obj) return cleaned || null;

  const year = typeof obj.year === "number" ? obj.year : parseInt(String(obj.year ?? ""), 10);
  const month = typeof obj.month === "number" ? obj.month : parseInt(String(obj.month ?? ""), 10);
  const day = typeof obj.day === "number" ? obj.day : parseInt(String(obj.day ?? ""), 10);
  const date = typeof obj.date === "string" ? obj.date.trim() : "";
  const dateText =
    date ||
    (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
      ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      : "");

  const weekdayCn = String(obj.weekday_cn ?? obj.weekdaycn ?? obj.weekdayCn ?? "").trim();
  const dayOfYearRaw = obj.day_of_year ?? obj.dayof_year ?? obj.dayOfYear;
  const dayOfYear = typeof dayOfYearRaw === "number" ? dayOfYearRaw : parseInt(String(dayOfYearRaw ?? ""), 10);

  if (!dateText && !weekdayCn) return cleaned || null;

  const parts: string[] = [];
  if (dateText) parts.push(`今天是 ${dateText}`);
  if (weekdayCn) parts.push(weekdayCn);
  let out = parts.join(" ");
  if (Number.isFinite(dayOfYear) && dayOfYear > 0) out = `${out}（今年第${dayOfYear}天）`;
  return out.trim();
}

export async function handleCommands(opts: {
  evt: ChatEvent;
  target: SendTarget;
  text: string;
  mcp: McpRegistry;
  notes: NoteStore;
  stats?: StatsStore;
}): Promise<CommandResult> {
  const nowMs = Date.now();
  const text = opts.text.trim();
  if (!text) return { handled: false };

  const wantsDate = REGEX_DATE.test(text);
  const wantsWeather = REGEX_WEATHER.test(text);
  const wantsNews = REGEX_NEWS.test(text);

  if (wantsDate || wantsWeather || wantsNews) {
    const parts: string[] = [];

    if (wantsDate) {
      try {
        await opts.stats?.recordToolCall({ date: formatDateLocal(opts.evt.timestampMs || nowMs), chatType: opts.evt.chatType, userId: opts.evt.userId, groupId: opts.evt.groupId }, "tools::get_date");
        const raw = await opts.mcp.callTool({ server: "tools", name: "get_date", arguments: {} });
        const reply = formatDateReplyFromToolOutput(raw);
        parts.push(reply || "今天日期暂时查不到。");
      } catch (e) {
        parts.push("今天日期暂时查不到。");
      }
    }

    if (wantsWeather) {
      const m =
        text.match(/今天\s*([\u4e00-\u9fff]{2,10})\s*天气/) ??
        text.match(/([\u4e00-\u9fff]{2,10})\s*(?:今天)?\s*天气/);
      const location = String(m?.[1] ?? "").trim();
      if (!location) {
        parts.push("你要查哪个城市的天气？例如：西安天气");
      } else {
        try {
          await opts.stats?.recordToolCall({ date: formatDateLocal(opts.evt.timestampMs || nowMs), chatType: opts.evt.chatType, userId: opts.evt.userId, groupId: opts.evt.groupId }, "tools::weather_query");
          const raw = await opts.mcp.callTool({ server: "tools", name: "weather_query", arguments: { location } });
          parts.push(sanitizeChatText(raw) || `${location} 的天气暂时查不到。`);
        } catch (e) {
          parts.push(`${location} 的天气暂时查不到。`);
        }
      }
    }

    if (wantsNews) {
      const q = /今天|今日/.test(text) ? "今日 新闻 摘要" : "新闻 摘要";
      try {
        await opts.stats?.recordToolCall({ date: formatDateLocal(opts.evt.timestampMs || nowMs), chatType: opts.evt.chatType, userId: opts.evt.userId, groupId: opts.evt.groupId }, "tools::web_search");
        const raw = await opts.mcp.callTool({ server: "tools", name: "web_search", arguments: { query: q } });
        const cleaned = sanitizeChatText(raw);
        parts.push(cleaned ? limitChatText(cleaned, { maxChars: 420, maxLines: 6 }) : "今天的新闻暂时没有获取到。");
      } catch (e) {
        parts.push("今天的新闻暂时没有获取到。");
      }
    }

    if (parts.length) return { handled: true, replyText: parts.join("\n") };
  }

  const statsCmd = ["今日用量", "我的用量", "今日统计", "我的统计", "token统计"].includes(text);
  if (statsCmd && opts.stats) {
    const date = formatDateLocal(opts.evt.timestampMs || nowMs);
    const st = opts.stats.getUserStats(date, { chatType: opts.evt.chatType, userId: opts.evt.userId, groupId: opts.evt.groupId });
    if (!st) return { handled: true, replyText: "今天暂无统计数据" };
    const toolTop = Object.entries(st.toolCallsByName ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, v]) => `${k}=${v}`)
      .join("，");
    const lines = [
      `日期：${st.date}`,
      `LLM：calls=${st.llmCalls}，prompt=${st.llmPromptTokens}，completion=${st.llmCompletionTokens}，total=${st.llmTotalTokens}`,
      `识图：calls=${st.visionCalls}，prompt=${st.visionPromptTokens}，completion=${st.visionCompletionTokens}，total=${st.visionTotalTokens}`,
      `工具：calls=${st.toolCalls}${toolTop ? `，top：${toolTop}` : ""}`,
      `文件：${opts.stats.getTodayCsvPath(opts.evt.timestampMs || nowMs)}`
    ];
    return { handled: true, replyText: lines.join("\n") };
  }

  const helpCmd = ["提醒帮助", "定时帮助", "笔记帮助", "定时提醒帮助"].includes(text);
  if (helpCmd) {
    return {
      handled: true,
      replyText:
        "提醒示例：\n" +
        "1) 5分钟后提醒我 喝水\n" +
        "2) @123456 1分钟后提醒@123456 开会\n" +
        "3) 在 20:30 提醒我 下楼拿快递\n" +
        "4) 2026-01-23 09:00 提醒我 交水电费\n" +
        "5) 查看提醒 / 取消提醒 <提醒ID>\n\n" +
        "笔记：记笔记 今天要买牛奶 / 查看笔记 / 删除笔记 <序号或笔记ID>"
    };
  }

  const noteAdd = parseNoteAdd(text);
  if (noteAdd) {
    const note = opts.notes.add(opts.evt, noteAdd);
    return { handled: true, replyText: `已记录笔记（${note.id.slice(0, 8)}）` };
  }

  if (isNoteList(text)) {
    const items = opts.notes.list(opts.evt, 10);
    if (!items.length) return { handled: true, replyText: "暂无笔记" };
    const lines = items.map((n, i) => `${i + 1}. ${n.text} (${n.id.slice(0, 8)})`);
    return { handled: true, replyText: `笔记：\n${lines.join("\n")}` };
  }

  const noteRm = parseNoteRemove(text);
  if (noteRm) {
    const removed = opts.notes.remove(opts.evt, noteRm);
    if (!removed) return { handled: true, replyText: "未找到要删除的笔记（支持：序号 或 笔记ID）" };
    return { handled: true, replyText: `已删除笔记（${removed.id.slice(0, 8)}）` };
  }

  if (isReminderList(text)) {
    try {
      await opts.stats?.recordToolCall({ date: formatDateLocal(opts.evt.timestampMs || nowMs), chatType: opts.evt.chatType, userId: opts.evt.userId, groupId: opts.evt.groupId }, "tools::reminder_list");
      const replyText = await opts.mcp.callTool({
        server: "tools",
        name: "reminder_list",
        arguments: { chat_type: opts.evt.chatType, user_id: opts.evt.userId, group_id: opts.evt.groupId }
      });
      return { handled: true, replyText: replyText || "暂无待提醒事项" };
    } catch (e) {
      return { handled: true, replyText: `查看提醒失败：${getErrorMessage(e)}` };
    }
  }

  const cancelId = parseReminderCancel(text);
  if (cancelId) {
    try {
      await opts.stats?.recordToolCall({ date: formatDateLocal(opts.evt.timestampMs || nowMs), chatType: opts.evt.chatType, userId: opts.evt.userId, groupId: opts.evt.groupId }, "tools::reminder_cancel");
      const replyText = await opts.mcp.callTool({
        server: "tools",
        name: "reminder_cancel",
        arguments: { user_id: opts.evt.userId, reminder_id: cancelId }
      });
      return { handled: true, replyText: replyText || "已处理" };
    } catch (e) {
      return { handled: true, replyText: `取消提醒失败：${getErrorMessage(e)}` };
    }
  }

  const remParsed = parseReminderRequests(text, nowMs);
  if (remParsed && remParsed.length) {
    try {
      await opts.stats?.recordToolCall({ date: formatDateLocal(opts.evt.timestampMs || nowMs), chatType: opts.evt.chatType, userId: opts.evt.userId, groupId: opts.evt.groupId }, "tools::reminder_create");
      const replyText = await opts.mcp.callTool({
        server: "tools",
        name: "reminder_create",
        arguments: {
          chat_type: opts.evt.chatType,
          user_id: opts.evt.userId,
          group_id: opts.evt.groupId,
          message_id: opts.evt.messageId,
          request: text,
          now_ms: nowMs
        }
      });
      return { handled: true, replyText: replyText || "已设置提醒" };
    } catch (e) {
      return { handled: true, replyText: `设置提醒失败：${getErrorMessage(e)}` };
    }
  }

  return { handled: false };
}
