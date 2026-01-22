import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AppConfig } from "../config.js";
import type { ChatEvent, SendMessage, SendTarget } from "../types.js";
import { ensureDir, resolveFromCwd } from "../utils/fs.js";

export type Reminder = {
  id: string;
  createdAtMs: number;
  dueAtMs: number;
  creatorUserId: string;
  creatorChatType: "private" | "group";
  creatorGroupId?: string;
  target: SendTarget;
  mentionUserId?: string;
  text: string;
  status: "pending" | "sent" | "canceled";
  sentAtMs?: number;
  canceledAtMs?: number;
  attempts?: number;
  nextAttemptAtMs?: number;
  lastError?: string;
};

function safeParseJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function atomicWriteJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = safeParseJson<T>(raw);
  return parsed ?? fallback;
}

function formatReminderFireText(rem: Reminder): string {
  const prefix = rem.mentionUserId ? `[CQ:at,qq=${rem.mentionUserId}] ` : "";
  return `${prefix}提醒：${rem.text}`;
}

export class ReminderScheduler {
  private readonly filePath: string;
  private reminders: Reminder[];
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: AppConfig,
    private readonly sendFn: (msg: SendMessage) => Promise<void>
  ) {
    const dataDir = resolveFromCwd(config.DATA_DIR);
    this.filePath = path.join(dataDir, "reminders.json");
    this.reminders = readJsonFile<Reminder[]>(this.filePath, []);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  listPending(scope: { userId: string; chatType: "private" | "group"; groupId?: string }): Reminder[] {
    return this.reminders
      .filter((r) => r.status === "pending")
      .filter((r) => r.creatorUserId === scope.userId)
      .filter((r) => (scope.chatType === "private" ? r.creatorChatType === "private" : r.creatorGroupId === scope.groupId))
      .sort((a, b) => a.dueAtMs - b.dueAtMs);
  }

  create(opts: {
    evt: ChatEvent;
    target: SendTarget;
    dueAtMs: number;
    text: string;
  }): Reminder {
    const rem: Reminder = {
      id: crypto.randomUUID(),
      createdAtMs: Date.now(),
      dueAtMs: opts.dueAtMs,
      creatorUserId: opts.evt.userId,
      creatorChatType: opts.evt.chatType,
      creatorGroupId: opts.evt.groupId,
      target: opts.target,
      mentionUserId: opts.target.chatType === "group" ? opts.evt.userId : undefined,
      text: opts.text.trim(),
      status: "pending",
      attempts: 0
    };
    this.reminders.push(rem);
    this.flush();
    return rem;
  }

  cancel(scope: { userId: string }, reminderId: string): Reminder | null {
    const rem = this.reminders.find((r) => r.id === reminderId && r.creatorUserId === scope.userId);
    if (!rem) return null;
    if (rem.status !== "pending") return rem;
    rem.status = "canceled";
    rem.canceledAtMs = Date.now();
    this.flush();
    return rem;
  }

  private flush(): void {
    atomicWriteJson(this.filePath, this.reminders);
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    const due = this.reminders
      .filter((r) => r.status === "pending")
      .filter((r) => r.dueAtMs <= now)
      .filter((r) => (r.nextAttemptAtMs ? r.nextAttemptAtMs <= now : true))
      .sort((a, b) => a.dueAtMs - b.dueAtMs)
      .slice(0, 10);

    if (!due.length) return;

    for (const rem of due) {
      try {
        await this.sendFn({ target: rem.target, text: formatReminderFireText(rem) });
        rem.status = "sent";
        rem.sentAtMs = Date.now();
        rem.lastError = undefined;
        rem.nextAttemptAtMs = undefined;
      } catch (e: any) {
        rem.attempts = (rem.attempts ?? 0) + 1;
        rem.lastError = e?.message ? String(e.message) : "send_failed";
        rem.nextAttemptAtMs = Date.now() + 10_000;
      }
    }
    this.flush();
  }
}

