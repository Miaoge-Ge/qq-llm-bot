import type { AppConfig } from "../config.js";
import type { ChatEvent } from "../types.js";

export type MemoryMessage = { role: "user" | "assistant"; content: string; atMs: number };

type Session = { messages: MemoryMessage[]; lastAtMs: number };

function keyFor(evt: ChatEvent): string | null {
  if (evt.chatType === "private") return `private::${evt.userId}`;
  if (!evt.groupId) return null;
  return `group::${evt.groupId}::${evt.userId}`;
}

function getLimits(cfg: AppConfig, evt: ChatEvent): { turns: number; ttlMs: number; maxChars: number } {
  if (evt.chatType === "group") {
    return {
      turns: Math.max(0, Number((cfg as any).GROUP_CONTEXT_TURNS ?? 0)),
      ttlMs: Math.max(0, Number((cfg as any).GROUP_CONTEXT_TTL_MS ?? 0)),
      maxChars: Math.max(40, Number((cfg as any).GROUP_CONTEXT_MAX_CHARS ?? 200))
    };
  }
  return {
    turns: Math.max(0, Number((cfg as any).PRIVATE_CONTEXT_TURNS ?? 0)),
    ttlMs: Math.max(0, Number((cfg as any).PRIVATE_CONTEXT_TTL_MS ?? 0)),
    maxChars: Math.max(80, Number((cfg as any).PRIVATE_CONTEXT_MAX_CHARS ?? 600))
  };
}

function clip(text: string, maxChars: number): string {
  const s = String(text ?? "").trim();
  if (!s) return "";
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}…`;
}

export class ConversationMemory {
  private sessions = new Map<string, Session>();

  constructor(private readonly config: AppConfig) {}

  addUser(evt: ChatEvent, text: string, atMs: number): void {
    this.add(evt, { role: "user", content: text, atMs }, atMs);
  }

  addAssistant(evt: ChatEvent, text: string, atMs: number): void {
    this.add(evt, { role: "assistant", content: text, atMs }, atMs);
  }

  getHistory(evt: ChatEvent, nowMs: number): MemoryMessage[] {
    const k = keyFor(evt);
    if (!k) return [];
    const s = this.sessions.get(k);
    if (!s) return [];
    const { ttlMs, turns } = getLimits(this.config, evt);
    if (ttlMs > 0 && nowMs - s.lastAtMs > ttlMs) {
      this.sessions.delete(k);
      return [];
    }
    if (turns <= 0) return [];
    const maxMsgs = Math.max(0, turns) * 2;
    return s.messages.slice(-maxMsgs);
  }

  private add(evt: ChatEvent, msg: MemoryMessage, nowMs: number): void {
    const k = keyFor(evt);
    if (!k) return;
    const { ttlMs, turns, maxChars } = getLimits(this.config, evt);
    if (turns <= 0) return;

    const content = clip(msg.content, maxChars);
    if (!content) return;

    const prev = this.sessions.get(k);
    const s: Session = prev ? { ...prev } : { messages: [], lastAtMs: nowMs };
    if (ttlMs > 0 && prev && nowMs - prev.lastAtMs > ttlMs) {
      s.messages = [];
    }
    s.lastAtMs = nowMs;
    s.messages = [...s.messages, { role: msg.role, content, atMs: msg.atMs }];

    const maxMsgs = Math.max(0, turns) * 2;
    if (s.messages.length > maxMsgs) s.messages = s.messages.slice(-maxMsgs);

    this.sessions.set(k, s);
  }
}

