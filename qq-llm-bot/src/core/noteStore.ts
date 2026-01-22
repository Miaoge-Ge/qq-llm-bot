import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AppConfig } from "../config.js";
import type { ChatEvent } from "../types.js";
import { ensureDir, resolveFromCwd } from "../utils/fs.js";

export type NoteScope =
  | { chatType: "private"; userId: string }
  | { chatType: "group"; groupId: string; userId: string };

export type Note = {
  id: string;
  createdAtMs: number;
  scope: NoteScope;
  text: string;
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

function scopeFromEvent(evt: ChatEvent): NoteScope {
  if (evt.chatType === "private") return { chatType: "private", userId: evt.userId };
  return { chatType: "group", groupId: evt.groupId ?? "unknown", userId: evt.userId };
}

function scopeKey(scope: NoteScope): string {
  if (scope.chatType === "private") return `p:${scope.userId}`;
  return `g:${scope.groupId}:${scope.userId}`;
}

export class NoteStore {
  private readonly filePath: string;
  private notes: Note[];

  constructor(private readonly config: AppConfig) {
    const dataDir = resolveFromCwd(config.DATA_DIR);
    this.filePath = path.join(dataDir, "notes.json");
    this.notes = readJsonFile<Note[]>(this.filePath, []);
  }

  add(evt: ChatEvent, text: string): Note {
    const note: Note = {
      id: crypto.randomUUID(),
      createdAtMs: Date.now(),
      scope: scopeFromEvent(evt),
      text: text.trim()
    };
    this.notes.push(note);
    this.flush();
    return note;
  }

  list(evt: ChatEvent, limit = 10): Note[] {
    const key = scopeKey(scopeFromEvent(evt));
    return this.notes
      .filter((n) => scopeKey(n.scope) === key)
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, Math.max(1, limit));
  }

  remove(evt: ChatEvent, idOrIndex: string): Note | null {
    const list = this.list(evt, 1000);
    const byId = list.find((n) => n.id === idOrIndex);
    const idx = Number.isFinite(Number(idOrIndex)) ? Number(idOrIndex) : NaN;
    const byIndex = Number.isFinite(idx) && idx >= 1 && idx <= list.length ? list[idx - 1] : undefined;
    const chosen = byId ?? byIndex;
    if (!chosen) return null;

    const i = this.notes.findIndex((n) => n.id === chosen.id);
    if (i < 0) return null;
    const [removed] = this.notes.splice(i, 1);
    this.flush();
    return removed;
  }

  private flush(): void {
    atomicWriteJson(this.filePath, this.notes);
  }
}

