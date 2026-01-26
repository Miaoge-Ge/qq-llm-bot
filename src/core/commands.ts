import type { ChatEvent, SendTarget } from "../types.js";
import type { McpRegistry } from "../mcp/registry.js";
import type { NoteStore } from "./noteStore.js";
import type { StatsStore } from "../stats/store.js";
import { formatDateLocal } from "../stats/store.js";
import { limitChatText, sanitizeChatText } from "../utils/text.js";
import type { NapCatClient } from "../adapters/napcatqq/NapCatClient.js";

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

function isReminderCancelNoArg(text: string): boolean {
  const t = String(text ?? "").trim();
  return t === "取消提醒" || t === "删除提醒";
}

function looksLikeReminderCreateRequest(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (!/提醒/.test(t)) return false;
  if (["提醒帮助", "定时帮助", "定时提醒帮助"].includes(t)) return false;
  if (/^(?:取消|删除)提醒\b/.test(t)) return false;
  if (/(?:提醒列表|查看提醒|我的提醒|列出提醒)$/.test(t)) return false;

  if (/(\d+|[零〇一二两三四五六七八九十]+)\s*(?:天|d|小时|h|分钟|分|min|m)\s*(?:后|以后|之后)/i.test(t)) return true;
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}(?:[:：]\d{1,2})/.test(t)) return true;
  if (/(?:在\s*)?(?:今天|明天|后天|今晚)?\s*\d{1,2}(?:(?:[:：点])\d{1,2})?\s*(?:提醒|叫|通知|发|发送)/.test(t)) return true;
  if (/(?:今天|明天|后天|今晚)\s*[^]{0,16}(?:\d{1,2}点半|\d{1,2}点|\d{1,2}[:：]\d{1,2})/.test(t)) return true;
  return false;
}

function parseNewsQuery(text: string): string | null {
  const t = String(text ?? "").trim();
  if (!t) return null;

  const m1 = t.match(/^(?:我要)?(?:搜|搜索|查|帮我搜|帮我查)\s*(.+)$/);
  if (m1) {
    const q0 = String(m1[1] ?? "").trim();
    if (!q0) return null;
    const m = q0.match(/^(.{1,24}?)(?:的)?(?:新闻|热搜)$/);
    if (m) {
      const topic = String(m[1] ?? "").trim();
      if (topic) return `${topic} 新闻`;
    }
    return q0;
  }

  const m2 = t.match(/^(.{1,24}?)(?:的)?(?:新闻|热搜)$/);
  if (m2) {
    const topic = String(m2[1] ?? "").trim();
    if (!topic) return null;
    if (["今天", "今日", "新闻", "热搜", "大事"].includes(topic)) return null;
    return `${topic} 新闻`;
  }

  const m3 = t.match(/^(?:关于|有关)\s*(.{1,24}?)\s*(?:新闻|热搜)$/);
  if (m3) {
    const topic = String(m3[1] ?? "").trim();
    return topic ? `${topic} 新闻` : null;
  }

  return null;
}

function isGenericNewsQuery(text: string): boolean {
  const t = String(text ?? "").trim();
  return ["新闻", "今日新闻", "今天新闻", "热搜", "今日热搜", "今天热搜", "大事", "今日大事", "今天大事"].includes(t);
}

function looksLikeWeatherSearchResult(text: string): boolean {
  const t = String(text ?? "");
  return /天气预报|weather\.com\.cn|m\.weather\.com\.cn|7天|15天|40天/.test(t);
}

function formatSearchResultsForNews(text: string): string {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  const cleaned = raw.replace(/^搜索结果：\s*/m, "").trim();
  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/\s*\([^()]*https?:\/\/[^()]*\)\s*$/i, "").trim())
    .map((l) => l.replace(/\s*-\s*$/g, "").trim())
    .slice(0, 10);

  const isSourceish = (s: string): boolean => {
    const t = s.trim();
    if (!t) return true;
    if (t.length <= 2) return true;
    if (/^(?:主页|首页|新闻|热搜)$/i.test(t)) return true;
    if (/^(?:为您精选|焦点新闻|头条新闻|今日要闻|要闻|国际|国内)\b/.test(t)) return true;
    if (/(?:热榜|榜单|排行榜|全站热榜|今日热榜)/.test(t)) return true;
    if (/BBC|CNN|NYT|纽约时报|央视网|新华网|人民网|澎湃|观察者网|中新网|虎扑|微博|抖音/i.test(t)) return true;
    if (/(?:新闻|中文网|新闻网|官网|主页)$/.test(t)) return true;
    return false;
  };

  const isBadNewsItem = (s: string): boolean => {
    const t = s.trim();
    if (!t) return true;
    if (/(?:热榜|榜单|排行榜|全站热榜|今日热榜)/.test(t)) return true;
    if (/top\s*hub|tophub/i.test(t)) return true;
    if (/^\d+$/.test(t)) return true;
    return false;
  };

  const pickHeadlineFromLine = (line: string): string[] => {
    const segs = line.split(" - ").map((x) => x.trim()).filter(Boolean);
    const title = segs[0] ?? "";
    const after = segs.length >= 2 ? segs.slice(1).join(" - ").trim() : "";
    const candidate = isSourceish(title) && after ? after : title || after || line.trim();

    return candidate
      .replace(/[|｜]/g, " ")
      .replace(/\s*[·•]\s*/g, " · ")
      .split(" · ")
      .map((x) => x.trim())
      .filter(Boolean);
  };

  const out: string[] = [];
  for (const line of lines) {
    for (const h0 of pickHeadlineFromLine(line)) {
      let h = h0
        .replace(/^(?:视频[,.，。]?\s*)+/g, "")
        .replace(/^主页[-–—]\s*/g, "")
        .replace(/^\s*[-–—]\s*/g, "")
        .replace(/^\.+\s*/, "")
        .replace(/^\d+\.+\s*/, "")
        .trim();
      if (!h) continue;
      if (looksLikeWeatherSearchResult(h)) continue;
      if (isSourceish(h)) continue;
      if (isBadNewsItem(h)) continue;
      if (/[.…]{1,}$/.test(h) || /\.\.\./.test(h)) continue;
      if (/[，,]\s*$/.test(h)) h = h.replace(/[，,]\s*$/, "").trimEnd();
      if (/[？?]\s*$/.test(h)) continue;
      if (h.length < 10) continue;
      if (out.some((x) => x === h)) continue;
      out.push(h);
      if (out.length >= 8) break;
    }
    if (out.length >= 8) break;
  }

  if (!out.length) return "";
  return `今天的新闻：\n${out.map((l, i) => `${i + 1}. ${l}`).join("\n")}`.trim();
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
  napcat?: NapCatClient;
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
        const raw = await opts.mcp.callTool({
          server: "tools",
          name: "get_date",
          arguments: { chat_type: opts.evt.chatType, user_id: opts.evt.userId, group_id: opts.evt.groupId }
        });
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
          const raw = await opts.mcp.callTool({
            server: "tools",
            name: "weather_query",
            arguments: { location, chat_type: opts.evt.chatType, user_id: opts.evt.userId, group_id: opts.evt.groupId }
          });
          parts.push(sanitizeChatText(raw) || `${location} 的天气暂时查不到。`);
        } catch (e) {
          parts.push(`${location} 的天气暂时查不到。`);
        }
      }
    }

    if (wantsNews) {
      const extracted = parseNewsQuery(text);
      const explicitNews = /有什么新闻/.test(text) || /今天.*新闻|今日.*新闻/.test(text);
      const q =
        extracted ||
        (explicitNews || isGenericNewsQuery(text)
          ? /今天|今日/.test(text)
            ? "今日 新闻 摘要"
            : "新闻 摘要"
          : "");
      if (!q) return { handled: false };
      try {
        await opts.stats?.recordToolCall({ date: formatDateLocal(opts.evt.timestampMs || nowMs), chatType: opts.evt.chatType, userId: opts.evt.userId, groupId: opts.evt.groupId }, "tools::web_search");
        const raw1 = await opts.mcp.callTool({
          server: "tools",
          name: "web_search",
          arguments: { query: q, chat_type: opts.evt.chatType, user_id: opts.evt.userId, group_id: opts.evt.groupId }
        });
        const cleaned1 = sanitizeChatText(raw1);
        let out = formatSearchResultsForNews(cleaned1);
        if (!out || looksLikeWeatherSearchResult(cleaned1)) {
          const q2 = /今天|今日/.test(text) ? "今日 热搜 新闻 摘要" : "热搜 新闻 摘要";
          const raw2 = await opts.mcp.callTool({
            server: "tools",
            name: "web_search",
            arguments: { query: q2, chat_type: opts.evt.chatType, user_id: opts.evt.userId, group_id: opts.evt.groupId }
          });
          const cleaned2 = sanitizeChatText(raw2);
          out = formatSearchResultsForNews(cleaned2);
        }
        parts.push(out ? limitChatText(out, { maxChars: 420, maxLines: 8 }) : "今天的新闻暂时没有获取到。");
      } catch (e) {
        parts.push("今天的新闻暂时没有获取到。");
      }
    }

    if (parts.length) return { handled: true, replyText: parts.join("\n") };
  }

  const groupProfileCmd = /(群信息|群资料|入群时间|入群天数|群聊等级)/.test(text);
  if (groupProfileCmd && opts.evt.chatType === "group" && opts.evt.groupId && opts.napcat) {
    const botId = opts.napcat.botId ? String(opts.napcat.botId).trim() : "";
    const atIdsAll = opts.evt.segments
      .filter((s) => s.type === "at")
      .map((s) => String((s as any).data?.qq ?? "").trim())
      .filter((id) => id && id !== "all");
    const atIds = atIdsAll.filter((id) => id !== botId);
    const mentionedId = atIds[0] ?? (atIdsAll.length >= 2 ? atIdsAll[1] : "");

    const mText = text.match(/@(\d{4,20})/);
    const targetUserId = (mText?.[1] ? String(mText[1]).trim() : mentionedId) || opts.evt.userId;
    const info = await opts.napcat.getGroupMemberInfo(opts.evt.groupId, targetUserId);
    if (!info) return { handled: true, replyText: "暂时查不到群成员信息。" };

    const joinTimeSec = Number((info as any).join_time ?? (info as any).joinTime ?? NaN);
    const joinMs = Number.isFinite(joinTimeSec) && joinTimeSec > 0 ? joinTimeSec * 1000 : NaN;
    const joinText = Number.isFinite(joinMs) ? new Date(joinMs).toLocaleString("zh-CN", { hour12: false }) : "";
    const days = Number.isFinite(joinMs) ? Math.max(0, Math.floor((Date.now() - joinMs) / 86400000)) : NaN;
    const level = String((info as any).level ?? (info as any).lv ?? "").trim();
    const nickname = String((info as any).nickname ?? "").trim();
    const card = String((info as any).card ?? "").trim();
    const displayName = card || nickname || targetUserId;

    const lines: string[] = [];
    lines.push(`群友：${displayName}（${targetUserId}）`);
    if (joinText) lines.push(`入群时间：${joinText}`);
    if (Number.isFinite(days)) lines.push(`入群天数：${days}天`);
    if (level) lines.push(`群聊等级：${level}`);
    return { handled: true, replyText: lines.join("\n") };
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
        "1.5) 2小时后提醒我 休息一下\n" +
        "1.6) 2天后提醒我 交房租\n" +
        "2) @123456 1分钟后提醒@123456 开会\n" +
        "3) 在 20:30 提醒我 下楼拿快递\n" +
        "4) 2026-01-23 09:00 提醒我 交水电费\n" +
        "5) 查看提醒 / 取消提醒 <序号或提醒ID>\n\n" +
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
  if (!cancelId && isReminderCancelNoArg(text)) {
    try {
      await opts.stats?.recordToolCall({ date: formatDateLocal(opts.evt.timestampMs || nowMs), chatType: opts.evt.chatType, userId: opts.evt.userId, groupId: opts.evt.groupId }, "tools::reminder_list");
      const listText = await opts.mcp.callTool({
        server: "tools",
        name: "reminder_list",
        arguments: { chat_type: opts.evt.chatType, user_id: opts.evt.userId, group_id: opts.evt.groupId, limit: 2 }
      });
      const ids = String(listText ?? "")
        .split("\n")
        .map((l) => l.trim())
        .map((l) => l.match(/（([^）]+)）/))
        .map((m) => String(m?.[1] ?? "").trim())
        .filter(Boolean);

      if (!ids.length) return { handled: true, replyText: "暂无待提醒事项" };
      if (ids.length === 1) {
        await opts.stats?.recordToolCall({ date: formatDateLocal(opts.evt.timestampMs || nowMs), chatType: opts.evt.chatType, userId: opts.evt.userId, groupId: opts.evt.groupId }, "tools::reminder_cancel");
        const replyText = await opts.mcp.callTool({
          server: "tools",
          name: "reminder_cancel",
          arguments: { user_id: opts.evt.userId, reminder_id: ids[0] }
        });
        return { handled: true, replyText: replyText || "已取消提醒" };
      }

      return {
        handled: true,
        replyText: `你有多个待提醒事项。\n${String(listText ?? "").trim()}\n\n请发送：取消提醒 1（或 取消提醒 <提醒ID>）`
      };
    } catch (e) {
      return { handled: true, replyText: `取消提醒失败：${getErrorMessage(e)}` };
    }
  }
  if (cancelId) {
    try {
      await opts.stats?.recordToolCall({ date: formatDateLocal(opts.evt.timestampMs || nowMs), chatType: opts.evt.chatType, userId: opts.evt.userId, groupId: opts.evt.groupId }, "tools::reminder_cancel");
      let effectiveId = cancelId;
      if (/^\d+$/.test(cancelId)) {
        const idx = Number(cancelId);
        if (Number.isFinite(idx) && idx > 0 && idx <= 20) {
          const listText = await opts.mcp.callTool({
            server: "tools",
            name: "reminder_list",
            arguments: { chat_type: opts.evt.chatType, user_id: opts.evt.userId, group_id: opts.evt.groupId, limit: Math.max(10, idx) }
          });
          const m = String(listText ?? "")
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l.startsWith(`${idx}.`))
            ?.match(/（([^）]+)）/);
          const picked = String(m?.[1] ?? "").trim();
          if (picked) effectiveId = picked;
        }
      }
      const replyText = await opts.mcp.callTool({
        server: "tools",
        name: "reminder_cancel",
        arguments: { user_id: opts.evt.userId, reminder_id: effectiveId }
      });
      return { handled: true, replyText: replyText || "已处理" };
    } catch (e) {
      return { handled: true, replyText: `取消提醒失败：${getErrorMessage(e)}` };
    }
  }

  if (looksLikeReminderCreateRequest(text)) {
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
