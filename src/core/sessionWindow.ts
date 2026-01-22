import type { AppConfig } from "../config.js";
import type { ChatEvent } from "../types.js";

type Session = { remaining: number; lastAtMs: number };

function sessionKey(evt: ChatEvent): string | null {
  if (evt.chatType !== "group") return null;
  if (!evt.groupId) return null;
  return `${evt.groupId}::${evt.userId}`;
}

function shouldEndByText(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return true;
  if (/(不用回复|别回复|停止回复|不用管了|结束对话)/.test(t)) return true;
  if (/^(好|好的|行|可以|ok|OK|收到|谢了|谢谢|不用了|没事了|结束|停止)$/.test(t)) return true;
  return false;
}

export class GroupConversationWindow {
  private sessions = new Map<string, Session>();

  constructor(private readonly config: AppConfig) {}

  start(evt: ChatEvent, nowMs: number): void {
    const k = sessionKey(evt);
    if (!k) return;
    const turns = Math.max(0, Number(this.config.GROUP_FOLLOWUP_TURNS ?? 0));
    this.sessions.set(k, { remaining: turns, lastAtMs: nowMs });
  }

  stop(evt: ChatEvent): void {
    const k = sessionKey(evt);
    if (!k) return;
    this.sessions.delete(k);
  }

  shouldHandleFollowup(evt: ChatEvent, text: string, nowMs: number): boolean {
    const k = sessionKey(evt);
    if (!k) return false;
    const ttlMs = Math.max(0, Number(this.config.GROUP_FOLLOWUP_TTL_MS ?? 0));
    const s = this.sessions.get(k);
    if (!s) return false;
    if (ttlMs > 0 && nowMs - s.lastAtMs > ttlMs) {
      this.sessions.delete(k);
      return false;
    }
    if (shouldEndByText(text)) {
      this.sessions.delete(k);
      return false;
    }
    if (s.remaining <= 0) {
      this.sessions.delete(k);
      return false;
    }
    s.remaining -= 1;
    s.lastAtMs = nowMs;
    this.sessions.set(k, s);
    return true;
  }
}

