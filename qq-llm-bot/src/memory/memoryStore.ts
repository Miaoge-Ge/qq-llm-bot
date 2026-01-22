import path from "node:path";
import crypto from "node:crypto";
import type { AppConfig } from "../config.js";
import type { ChatType } from "../types.js";
import { readJsonl, appendJsonl } from "../utils/jsonl.js";
import { resolveFromCwd } from "../utils/fs.js";
import type { OpenAiCompatClient } from "../llm/openaiCompat.js";

export type StoredMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  timestampMs: number;
  messageId?: string;
};

export type LongMemory = {
  id: string;
  scopeKey: string;
  content: string;
  timestampMs: number;
  embedding?: number[];
};

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class MemoryStore {
  private readonly messagesFile: string;
  private readonly memoriesFile: string;
  private messages: StoredMessage[];
  private memories: LongMemory[];

  constructor(
    private readonly config: AppConfig,
    private readonly llm: OpenAiCompatClient
  ) {
    const dataDir = resolveFromCwd(config.DATA_DIR);
    this.messagesFile = path.join(dataDir, "messages.jsonl");
    this.memoriesFile = path.join(dataDir, "memories.jsonl");

    this.messages = readJsonl<StoredMessage>(this.messagesFile);
    this.memories = readJsonl<LongMemory>(this.memoriesFile);
  }

  conversationId(chatType: ChatType, userId: string, groupId?: string): string {
    if (chatType === "private") return `private:${userId}`;
    return `group_user:${groupId ?? "unknown"}:${userId}`;
  }

  scopeKeysFor(chatType: ChatType, userId: string, groupId?: string): string[] {
    if (chatType === "private") return ["global", `user:${userId}`];
    return [
      "global",
      `group:${groupId ?? "unknown"}`,
      `group_user:${groupId ?? "unknown"}:${userId}`
    ];
  }

  addMessage(m: Omit<StoredMessage, "id">): void {
    const rec: StoredMessage = { ...m, id: crypto.randomUUID() };
    this.messages.push(rec);
    appendJsonl(this.messagesFile, rec);
  }

  recentMessages(conversationId: string, maxTurns: number): StoredMessage[] {
    const all = this.messages.filter((m) => m.conversationId === conversationId);
    return all.slice(-Math.max(1, maxTurns * 2));
  }

  async addLongMemory(opts: { scopeKey: string; content: string; timestampMs: number }): Promise<void> {
    const id = crypto.randomUUID();
    const rec: LongMemory = { id, scopeKey: opts.scopeKey, content: opts.content, timestampMs: opts.timestampMs };
    if (this.config.EMBEDDING_MODEL && this.config.LLM_API_KEY) {
      rec.embedding = await this.llm.embed({ model: this.config.EMBEDDING_MODEL, input: opts.content });
    }
    this.memories.push(rec);
    appendJsonl(this.memoriesFile, rec);
  }

  async searchLongMemory(scopeKeys: string[], query: string, topK: number): Promise<LongMemory[]> {
    const pool = this.memories.filter((m) => scopeKeys.includes(m.scopeKey));
    if (!pool.length) return [];

    if (this.config.EMBEDDING_MODEL && this.config.LLM_API_KEY) {
      const q = await this.llm.embed({ model: this.config.EMBEDDING_MODEL, input: query });
      return pool
        .filter((m) => Array.isArray(m.embedding) && m.embedding.length > 0)
        .map((m) => ({ m, score: cosineSimilarity(q, m.embedding!) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((x) => x.m);
    }

    const q = query.trim();
    return pool
      .map((m) => ({ m, score: m.content.includes(q) ? 1 : 0 }))
      .filter((x) => x.score > 0)
      .slice(0, topK)
      .map((x) => x.m);
  }
}

