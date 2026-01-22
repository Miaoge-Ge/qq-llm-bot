import type { ChatEvent, SendTarget } from "../types.js";
import type { ReminderScheduler } from "./reminderScheduler.js";
import type { NoteStore } from "./noteStore.js";

export type CommandResult = { handled: true; replyText: string } | { handled: false };

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function parseCnNumber(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);

  const map: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };

  let total = 0;
  let cur = 0;
  for (const ch of s) {
    if (ch === "十") {
      cur = cur === 0 ? 1 : cur;
      total += cur * 10;
      cur = 0;
      continue;
    }
    const v = map[ch];
    if (typeof v !== "number") return null;
    cur += v;
  }
  total += cur;
  if (!Number.isFinite(total)) return null;
  return total;
}

function parseHm(text: string): { hour: number; minute: number } | null {
  const m = text.match(/^(\d{1,2})(?:[:：点](\d{1,2}))?$/);
  if (!m) return null;
  const hour = clampInt(Number(m[1]), 0, 23);
  const minute = clampInt(m[2] ? Number(m[2]) : 0, 0, 59);
  return { hour, minute };
}

function computeNextTime(opts: { dayHint?: "today" | "tomorrow" | "day_after_tomorrow"; hour: number; minute: number; nowMs: number }): number {
  const now = new Date(opts.nowMs);
  const base = new Date(now);
  base.setSeconds(0, 0);
  base.setHours(opts.hour, opts.minute, 0, 0);

  const addDays = (d: number) => base.setDate(base.getDate() + d);
  if (opts.dayHint === "tomorrow") addDays(1);
  else if (opts.dayHint === "day_after_tomorrow") addDays(2);

  if (!opts.dayHint && base.getTime() <= opts.nowMs) addDays(1);
  return base.getTime();
}

function parseDelayReminder(text: string, nowMs: number): { dueAtMs: number; message: string } | null {
  const t = text.trim();

  const r1 = t.match(
    /^(?:(?:提醒|叫|通知|发|发送)(?:我|你)?\s*)?(?:(\d+|[零〇一二两三四五六七八九十]+)\s*(?:小时|h))?\s*(?:(\d+|[零〇一二两三四五六七八九十]+)\s*(?:分钟|分|min|m))?\s*后\s*(?:(?:提醒|叫|通知|发|发送)(?:我|你)?\s*)?(.+)$/i
  );
  const r2 = t.match(
    /^(?:(\d+|[零〇一二两三四五六七八九十]+)\s*(?:小时|h))?\s*(?:(\d+|[零〇一二两三四五六七八九十]+)\s*(?:分钟|分|min|m))?\s*后\s*(?:提醒|叫|通知|发|发送)(?:我|你)?\s*(.+)$/i
  );
  const m = r1 ?? r2;
  if (!m) return null;

  const hoursRaw = (m[1] ?? "").trim();
  const minsRaw = (m[2] ?? "").trim();
  const hours = hoursRaw ? clampInt(parseCnNumber(hoursRaw) ?? NaN, 0, 168) : 0;
  const mins = minsRaw ? clampInt(parseCnNumber(minsRaw) ?? NaN, 0, 10080) : 0;
  if (!hours && !mins) return null;
  const delayMs = (hours * 60 + mins) * 60_000;
  const msg = (m[3] ?? "").trim();
  if (!msg) return null;
  return { dueAtMs: nowMs + delayMs, message: msg };
}

function parseAbsoluteReminder(text: string, nowMs: number): { dueAtMs: number; message: string } | null {
  const t = text.trim();

  const rDateTime = t.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2})(?:[:：](\d{1,2}))\s*(?:提醒|叫|通知|发|发送)(?:我)?\s*(.+)$/
  );
  if (rDateTime) {
    const year = Number(rDateTime[1]);
    const month = clampInt(Number(rDateTime[2]), 1, 12);
    const day = clampInt(Number(rDateTime[3]), 1, 31);
    const hour = clampInt(Number(rDateTime[4]), 0, 23);
    const minute = clampInt(Number(rDateTime[5]), 0, 59);
    const msg = rDateTime[6].trim();
    if (!msg) return null;
    const due = new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
    if (!Number.isFinite(due) || due <= nowMs) return null;
    return { dueAtMs: due, message: msg };
  }

  const rHm = t.match(/^(?:在\s*)?(今天|明天|后天|今晚)?\s*(\d{1,2}(?:[:：点]\d{1,2})?)\s*(?:提醒|叫|通知|发|发送)(?:我)?\s*(.+)$/);
  if (!rHm) return null;
  const hintRaw = (rHm[1] ?? "").trim();
  const hm = parseHm(rHm[2].trim());
  const msg = rHm[3].trim();
  if (!hm || !msg) return null;
  const dayHint =
    hintRaw === "明天" ? "tomorrow" : hintRaw === "后天" ? "day_after_tomorrow" : hintRaw === "今天" ? "today" : hintRaw ? "today" : undefined;
  const dueAtMs = computeNextTime({ dayHint, hour: hm.hour, minute: hm.minute, nowMs });
  if (dueAtMs <= nowMs) return null;
  return { dueAtMs, message: msg };
}

function parseReminder(text: string, nowMs: number): { dueAtMs: number; message: string } | null {
  return parseDelayReminder(text, nowMs) ?? parseAbsoluteReminder(text, nowMs);
}

function parseNoteAdd(text: string): string | null {
  const m = text.trim().match(/^(?:记(?:一下)?|写)(?:个)?笔记[:：\s]+(.+)$/);
  if (!m) return null;
  const body = m[1].trim();
  return body ? body : null;
}

function isNoteList(text: string): boolean {
  const t = text.trim();
  return t === "查看笔记" || t === "我的笔记" || t === "笔记列表" || t === "列出笔记";
}

function parseNoteRemove(text: string): string | null {
  const m = text.trim().match(/^(?:删除|移除)笔记\s+(.+)$/);
  if (!m) return null;
  const v = m[1].trim();
  return v ? v : null;
}

function isReminderList(text: string): boolean {
  const t = text.trim();
  return t === "查看提醒" || t === "我的提醒" || t === "提醒列表" || t === "列出提醒";
}

function parseReminderCancel(text: string): string | null {
  const m = text.trim().match(/^(?:取消|删除)提醒\s+(.+)$/);
  if (!m) return null;
  const v = m[1].trim();
  return v ? v : null;
}

function formatTargetForAck(target: SendTarget, creatorUserId: string): string {
  if (target.chatType === "private") return "私聊";
  return `群(${target.groupId})@${creatorUserId}`;
}

export function handleCommands(opts: {
  evt: ChatEvent;
  target: SendTarget;
  text: string;
  reminders: ReminderScheduler;
  notes: NoteStore;
}): CommandResult {
  const nowMs = Date.now();
  const text = opts.text.trim();
  if (!text) return { handled: false };

  const helpCmd = text === "提醒帮助" || text === "定时帮助" || text === "笔记帮助" || text === "定时提醒帮助";
  if (helpCmd) {
    return {
      handled: true,
      replyText:
        "可用指令：\n" +
        "1) 5分钟后提醒我 喝水\n" +
        "2) 1小时后发 会议开始\n" +
        "3) 在 20:30 提醒我 下楼拿快递\n" +
        "4) 2026-01-23 09:00 提醒我 交水电费\n" +
        "5) 查看提醒 / 取消提醒 <提醒ID>\n" +
        "6) 记笔记 今天要买牛奶 / 查看笔记 / 删除笔记 <序号或笔记ID>"
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
    const list = opts.reminders.listPending({ userId: opts.evt.userId, chatType: opts.evt.chatType, groupId: opts.evt.groupId });
    if (!list.length) return { handled: true, replyText: "暂无待提醒事项" };
    const lines = list.slice(0, 10).map((r, i) => `${i + 1}. ${fmtTime(r.dueAtMs)}：${r.text} (${r.id.slice(0, 8)})`);
    return { handled: true, replyText: `待提醒：\n${lines.join("\n")}` };
  }

  const cancelId = parseReminderCancel(text);
  if (cancelId) {
    const rem = opts.reminders.cancel({ userId: opts.evt.userId }, cancelId);
    if (!rem) return { handled: true, replyText: "未找到要取消的提醒（支持：提醒ID）" };
    return { handled: true, replyText: rem.status === "canceled" ? "已取消提醒" : "该提醒已不是待执行状态" };
  }

  const remParsed = parseReminder(text, nowMs);
  if (remParsed) {
    const rem = opts.reminders.create({ evt: opts.evt, target: opts.target, dueAtMs: remParsed.dueAtMs, text: remParsed.message });
    return {
      handled: true,
      replyText: `已设置提醒：${fmtTime(rem.dueAtMs)}（${formatTargetForAck(opts.target, opts.evt.userId)}，ID:${rem.id.slice(0, 8)}）`
    };
  }

  return { handled: false };
}
