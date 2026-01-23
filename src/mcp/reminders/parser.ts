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

function parseTimeToken(text: string): { hour: number; minute: number } | null {
  const t = String(text ?? "").trim();
  if (!t) return null;
  const m1 = t.match(/^(\d{1,2})\s*(?:[:：]\s*(\d{1,2}))$/);
  if (m1) return { hour: clampInt(Number(m1[1]), 0, 23), minute: clampInt(Number(m1[2]), 0, 59) };
  const m2 = t.match(/^(\d{1,2})\s*点\s*半$/);
  if (m2) return { hour: clampInt(Number(m2[1]), 0, 23), minute: 30 };
  const m3 = t.match(/^(\d{1,2})\s*点\s*(\d{1,2})$/);
  if (m3) return { hour: clampInt(Number(m3[1]), 0, 23), minute: clampInt(Number(m3[2]), 0, 59) };
  const m4 = t.match(/^(\d{1,2})\s*点$/);
  if (m4) return { hour: clampInt(Number(m4[1]), 0, 23), minute: 0 };
  return parseHm(t);
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

function stripMentions(text: string): string {
  return String(text ?? "")
    .replace(/@\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractMentionIds(text: string): string[] {
  const out: string[] = [];
  const re = /@(\d+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const id = String(m[1] ?? "").trim();
    if (id) out.push(id);
  }
  return out;
}

export function isSelfReminderRequest(text: string): boolean {
  const t = String(text ?? "");
  if (!t) return false;
  if (/(?:提醒|叫|通知|发|发送)\s*(?:一下|下)?\s*(?:我|自己)\b/.test(t)) return true;
  if (/提醒我(?!们)/.test(t)) return true;
  return false;
}

export function pickMentionUserIdForReminderRequest(text: string): string | undefined {
  const raw = String(text ?? "");
  const i = raw.indexOf("提醒");
  if (i >= 0) {
    const after = raw.slice(i);
    const ids = extractMentionIds(after);
    if (ids.length) return ids[0];
  }
  const ids = extractMentionIds(raw);
  return ids[0];
}

function parseDelayReminder(text: string, nowMs: number): { dueAtMs: number; message: string } | null {
  const t = stripMentions(text);

  const r1 = t.match(
    /^(?:(?:提醒|叫|通知|发|发送)(?:我|你)?\s*)?(?:(\d+|[零〇一二两三四五六七八九十]+)\s*(?:天|d))?\s*(?:(\d+|[零〇一二两三四五六七八九十]+)\s*(?:小时|h))?\s*(?:(\d+|[零〇一二两三四五六七八九十]+)\s*(?:分钟|分|min|m))?\s*(?:后|以后|之后)\s*(?:(?:提醒|叫|通知|发|发送)(?:我|你)?\s*)?(.+)$/i
  );
  const r2 = t.match(
    /^(?:(\d+|[零〇一二两三四五六七八九十]+)\s*(?:天|d))?\s*(?:(\d+|[零〇一二两三四五六七八九十]+)\s*(?:小时|h))?\s*(?:(\d+|[零〇一二两三四五六七八九十]+)\s*(?:分钟|分|min|m))?\s*(?:后|以后|之后)\s*(?:提醒|叫|通知|发|发送)(?:我|你)?\s*(.+)$/i
  );
  const m = r1 ?? r2;
  if (!m) return null;

  const daysRaw = (m[1] ?? "").trim();
  const hoursRaw = (m[2] ?? "").trim();
  const minsRaw = (m[3] ?? "").trim();
  const days = daysRaw ? clampInt(parseCnNumber(daysRaw) ?? NaN, 0, 365) : 0;
  const hours = hoursRaw ? clampInt(parseCnNumber(hoursRaw) ?? NaN, 0, 168) : 0;
  const mins = minsRaw ? clampInt(parseCnNumber(minsRaw) ?? NaN, 0, 10080) : 0;
  if (!days && !hours && !mins) return null;
  const delayMs = (days * 24 * 60 + hours * 60 + mins) * 60_000;
  const msg = stripMentions(m[4] ?? "");
  if (!msg) return null;
  return { dueAtMs: nowMs + delayMs, message: msg };
}

function parseAbsoluteReminder(text: string, nowMs: number): { dueAtMs: number; message: string } | null {
  const t = stripMentions(text);

  const rDateTime = t.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2})(?:[:：](\d{1,2}))\s*(?:提醒|叫|通知|发|发送)(?:我)?\s*(.+)$/
  );
  if (rDateTime) {
    const year = Number(rDateTime[1]);
    const month = clampInt(Number(rDateTime[2]), 1, 12);
    const day = clampInt(Number(rDateTime[3]), 1, 31);
    const hour = clampInt(Number(rDateTime[4]), 0, 23);
    const minute = clampInt(Number(rDateTime[5]), 0, 59);
    const msg = stripMentions(rDateTime[6]);
    if (!msg) return null;
    const due = new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
    if (!Number.isFinite(due) || due <= nowMs) return null;
    return { dueAtMs: due, message: msg };
  }

  const rHm = t.match(/^(?:在\s*)?(今天|明天|后天|今晚)?\s*(\d{1,2}(?:[:：点]\d{1,2})?)\s*(?:提醒|叫|通知|发|发送)(?:我)?\s*(.+)$/);
  if (!rHm) return null;
  const hintRaw = (rHm[1] ?? "").trim();
  const hm = parseHm(rHm[2].trim());
  const msg = stripMentions(rHm[3]);
  if (!hm || !msg) return null;
  const dayHint =
    hintRaw === "明天" ? "tomorrow" : hintRaw === "后天" ? "day_after_tomorrow" : hintRaw === "今天" ? "today" : hintRaw ? "today" : undefined;
  const dueAtMs = computeNextTime({ dayHint, hour: hm.hour, minute: hm.minute, nowMs });
  if (dueAtMs <= nowMs) return null;
  return { dueAtMs, message: msg };
}

function parseMultiAbsoluteReminder(text: string, nowMs: number): { dueAtMs: number; message: string }[] | null {
  const t = stripMentions(text);
  const m = t.match(/^(?:在\s*)?(今天|明天|后天|今晚)?\s*([^]+?)\s*(?:提醒|叫|通知|发|发送)(?:我|你|ta|他|她)?\s*(.+)$/);
  if (!m) return null;

  const hintRaw = (m[1] ?? "").trim();
  const timesRaw = String(m[2] ?? "").trim();
  const msg = stripMentions(m[3] ?? "");
  if (!timesRaw || !msg) return null;

  const dayHint =
    hintRaw === "明天" ? "tomorrow" : hintRaw === "后天" ? "day_after_tomorrow" : hintRaw === "今天" ? "today" : hintRaw ? "today" : undefined;

  const candidates = timesRaw
    .replace(/[，、]/g, ",")
    .replace(/\s+/g, " ")
    .split(/[,\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  if (candidates.length < 2) return null;

  const out: { dueAtMs: number; message: string }[] = [];
  for (const c of candidates) {
    const hm = parseTimeToken(c);
    if (!hm) continue;
    const dueAtMs = computeNextTime({ dayHint, hour: hm.hour, minute: hm.minute, nowMs });
    if (dueAtMs <= nowMs) continue;
    out.push({ dueAtMs, message: msg });
  }

  const uniq = new Map<number, { dueAtMs: number; message: string }>();
  for (const r of out) uniq.set(r.dueAtMs, r);
  const list = [...uniq.values()].sort((a, b) => a.dueAtMs - b.dueAtMs);
  return list.length >= 2 ? list : null;
}

export function parseReminderRequest(text: string, nowMs: number): { dueAtMs: number; message: string } | null {
  return parseDelayReminder(text, nowMs) ?? parseAbsoluteReminder(text, nowMs);
}

export function parseReminderRequests(text: string, nowMs: number): { dueAtMs: number; message: string }[] | null {
  const multi = parseMultiAbsoluteReminder(text, nowMs);
  if (multi && multi.length) return multi;
  const one = parseReminderRequest(text, nowMs);
  return one ? [one] : null;
}
