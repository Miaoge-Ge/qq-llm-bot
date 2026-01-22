import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AppConfig } from "../../config.js";
import type { ReminderRecord } from "./types.js";
import { ensureDir, resolveFromCwd } from "../../utils/fs.js";

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

export class ReminderStore {
  private readonly filePath: string;
  private readonly lockDir: string;
  private reminders: ReminderRecord[];

  constructor(private readonly config: AppConfig) {
    const dataDir = resolveFromCwd(config.DATA_DIR);
    this.filePath = path.join(dataDir, "reminders.json");
    this.lockDir = path.join(dataDir, "reminders.locks");
    this.reminders = readJsonFile<ReminderRecord[]>(this.filePath, []);
  }

  private refresh(): void {
    this.reminders = readJsonFile<ReminderRecord[]>(this.filePath, []);
  }

  private lockPath(reminderId: string): string {
    return path.join(this.lockDir, `${reminderId}.lock`);
  }

  tryAcquireSendLock(reminderId: string, nowMs: number): boolean {
    ensureDir(this.lockDir);
    const p = this.lockPath(reminderId);
    const staleMs = 2 * 60_000;
    try {
      const fd = fs.openSync(p, "wx");
      fs.writeFileSync(fd, `${process.pid}\n${nowMs}\n`, "utf8");
      fs.closeSync(fd);
      return true;
    } catch {
      try {
        const st = fs.statSync(p);
        if (nowMs - st.mtimeMs > staleMs) {
          fs.unlinkSync(p);
          const fd = fs.openSync(p, "wx");
          fs.writeFileSync(fd, `${process.pid}\n${nowMs}\n`, "utf8");
          fs.closeSync(fd);
          return true;
        }
      } catch {}
      return false;
    }
  }

  releaseSendLock(reminderId: string): void {
    const p = this.lockPath(reminderId);
    try {
      fs.unlinkSync(p);
    } catch {}
  }

  listAll(): ReminderRecord[] {
    this.refresh();
    return [...this.reminders];
  }

  listPendingByCreator(scope: { userId: string; chatType: "private" | "group"; groupId?: string }): ReminderRecord[] {
    this.refresh();
    return this.reminders
      .filter((r) => r.status === "pending" || r.status === "sending")
      .filter((r) => r.creatorUserId === scope.userId)
      .filter((r) => (scope.chatType === "private" ? r.creatorChatType === "private" : r.creatorGroupId === scope.groupId))
      .sort((a, b) => a.dueAtMs - b.dueAtMs);
  }

  claimDue(nowMs: number, limit: number): ReminderRecord[] {
    this.refresh();
    const staleMs = 2 * 60_000;
    let changed = false;

    for (const r of this.reminders) {
      if (r.status !== "sending") continue;
      const claimedAt = Number(r.claimedAtMs ?? 0);
      if (claimedAt && nowMs - claimedAt > staleMs) {
        r.status = "pending";
        r.claimedAtMs = undefined;
        changed = true;
      }
    }

    const due = this.reminders
      .filter((r) => r.status === "pending")
      .filter((r) => r.dueAtMs <= nowMs)
      .filter((r) => (r.nextAttemptAtMs ? r.nextAttemptAtMs <= nowMs : true))
      .sort((a, b) => a.dueAtMs - b.dueAtMs)
      .slice(0, limit);

    for (const r of due) {
      r.status = "sending";
      r.claimedAtMs = nowMs;
      changed = true;
    }

    if (changed) this.flush();
    return due.map((r) => ({ ...r }));
  }

  create(opts: Omit<ReminderRecord, "id" | "createdAtMs" | "status" | "attempts">): ReminderRecord {
    this.refresh();
    if (opts.sourceMessageId) {
      const sid = String(opts.sourceMessageId).trim();
      const existing = this.reminders.find(
        (r) =>
          r.sourceMessageId === sid &&
          r.creatorUserId === opts.creatorUserId &&
          r.creatorChatType === opts.creatorChatType &&
          r.dueAtMs === opts.dueAtMs &&
          r.text === String(opts.text ?? "").trim() &&
          (opts.creatorChatType === "group" ? r.creatorGroupId === opts.creatorGroupId : true)
      );
      if (existing) return existing;
    }

    const rem: ReminderRecord = {
      id: crypto.randomUUID(),
      createdAtMs: Date.now(),
      status: "pending",
      attempts: 0,
      ...opts,
      text: String(opts.text ?? "").trim()
    };
    this.reminders.push(rem);
    this.flush();
    return rem;
  }

  cancel(scope: { userId: string }, reminderId: string): ReminderRecord | null {
    this.refresh();
    const key = String(reminderId ?? "").trim();
    if (!key) return null;
    const exact = this.reminders.find((r) => r.id === key && r.creatorUserId === scope.userId);
    const rem =
      exact ??
      (key.length < 36 ? this.reminders.find((r) => r.creatorUserId === scope.userId && r.id.startsWith(key)) : undefined);
    if (!rem) return null;
    if (rem.status !== "pending" && rem.status !== "sending") return rem;
    rem.status = "canceled";
    rem.canceledAtMs = Date.now();
    rem.nextAttemptAtMs = undefined;
    rem.claimedAtMs = undefined;
    this.releaseSendLock(rem.id);
    this.flush();
    return rem;
  }

  markSent(reminderId: string): void {
    this.refresh();
    const rem = this.reminders.find((r) => r.id === reminderId);
    if (!rem) return;
    rem.status = "sent";
    rem.sentAtMs = Date.now();
    rem.lastError = undefined;
    rem.nextAttemptAtMs = undefined;
    rem.claimedAtMs = undefined;
    this.releaseSendLock(rem.id);
    this.flush();
  }

  markFailed(reminderId: string, error: string): void {
    this.refresh();
    const rem = this.reminders.find((r) => r.id === reminderId);
    if (!rem) return;
    rem.status = "pending";
    rem.attempts = (rem.attempts ?? 0) + 1;
    rem.lastError = error || "send_failed";
    rem.nextAttemptAtMs = Date.now() + 10_000;
    rem.claimedAtMs = undefined;
    this.releaseSendLock(rem.id);
    this.flush();
  }

  flush(): void {
    atomicWriteJson(this.filePath, this.reminders);
  }
}
