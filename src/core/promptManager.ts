import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { logger } from "../logger.js";
import type { ChatEvent } from "../types.js";
import { resolveFromProjectRoot } from "../utils/fs.js";

type PromptMap = { groups: Record<string, string | string[]> };

function isSafeId(id: string): boolean {
  return /^[a-zA-Z0-9._-]{1,64}$/.test(id);
}

function normalizeMap(json: unknown): PromptMap {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const anyObj = json as any;
    if (anyObj.groups && typeof anyObj.groups === "object" && !Array.isArray(anyObj.groups)) {
      return { groups: anyObj.groups as Record<string, string | string[]> };
    }
    return { groups: anyObj as Record<string, string | string[]> };
  }
  return { groups: {} };
}

type Cached<T> = { mtimeMs: number; value: T } | null;

export class PromptManager {
  private mapCache: Cached<PromptMap> = null;
  private promptCache = new Map<string, Cached<string>>();

  constructor(private readonly config: AppConfig) {}

  getPromptForEvent(evt: ChatEvent): string | undefined {
    if (evt.chatType !== "group" || !evt.groupId) return this.defaultPrompt();
    const map = this.loadMap();
    const raw = map.groups[evt.groupId];
    const ids = Array.isArray(raw) ? raw.map((x) => String(x ?? "").trim()).filter(Boolean) : [String(raw ?? "").trim()].filter(Boolean);
    if (!ids.length) return this.defaultPrompt();

    const groupParts: string[] = [];
    for (const id of ids) {
      const p = this.loadPromptById(id);
      if (p) groupParts.push(p);
      else logger.warn({ groupId: evt.groupId, promptId: id }, "Group prompt not found, fallback");
    }
    const groupPrompt = groupParts.join("\n\n").trim();
    const base = this.defaultPrompt();
    if (base && groupPrompt) return `${base}\n\n${groupPrompt}`.trim();
    return (groupPrompt || base) ?? undefined;
  }

  private defaultPrompt(): string | undefined {
    const s = String(this.config.SYSTEM_PROMPT ?? "").trim();
    return s || undefined;
  }

  private loadMap(): PromptMap {
    const rel = String(this.config.GROUP_PROMPT_MAP_FILE ?? "").trim();
    const abs = resolveFromProjectRoot(rel || "prompts/group-prompts.json");
    try {
      const st = fs.statSync(abs);
      const prev = this.mapCache;
      if (prev && prev.mtimeMs === st.mtimeMs) return prev.value;
      const raw = fs.readFileSync(abs, "utf8");
      const json = JSON.parse(raw);
      const value = normalizeMap(json);
      this.mapCache = { mtimeMs: st.mtimeMs, value };
      return value;
    } catch (err) {
      logger.warn({ err, abs }, "Failed to load group prompt map, fallback to empty");
      this.mapCache = { mtimeMs: 0, value: { groups: {} } };
      return { groups: {} };
    }
  }

  private loadPromptById(idRaw: string): string | null {
    const id = String(idRaw ?? "").trim();
    if (!id) return null;

    const fileName = id.includes(".") ? id : `${id}.txt`;
    if (!isSafeId(fileName)) return null;

    const abs = resolveFromProjectRoot(path.join("prompts", fileName));
    try {
      const st = fs.statSync(abs);
      const prev = this.promptCache.get(abs);
      if (prev && prev.mtimeMs === st.mtimeMs) return prev.value;
      const text = fs.readFileSync(abs, "utf8").trim();
      const value = text || "";
      this.promptCache.set(abs, { mtimeMs: st.mtimeMs, value });
      return value || null;
    } catch {
      return null;
    }
  }
}
