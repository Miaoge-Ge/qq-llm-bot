import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { ensureDir } from "../utils/fs.js";
import type { DailyUserStats, StatsScope, TokenUsage } from "./types.js";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatDateLocal(ms = Date.now()): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function keyOf(scope: StatsScope): string {
  return `${scope.chatType}|${scope.groupId ?? ""}|${scope.userId}`;
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (!/[,"\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function safeParseJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function atomicWriteText(filePath: string, text: string): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, filePath);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          cur += '"';
          i++;
          continue;
        }
        inQuotes = false;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(filePath: string): Map<string, DailyUserStats> {
  const map = new Map<string, DailyUserStats>();
  if (!fs.existsSync(filePath)) return map;
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return map;
  const header = parseCsvLine(lines[0]!).map((x) => x.trim());
  const idx = (name: string) => header.indexOf(name);

  const iDate = idx("date");
  const iChat = idx("chat_type");
  const iGroup = idx("group_id");
  const iUser = idx("user_id");
  const iLlmCalls = idx("llm_calls");
  const iLlmPrompt = idx("llm_prompt_tokens");
  const iLlmComp = idx("llm_completion_tokens");
  const iLlmTotal = idx("llm_total_tokens");
  const iVisionCalls = idx("vision_calls");
  const iVisionPrompt = idx("vision_prompt_tokens");
  const iVisionComp = idx("vision_completion_tokens");
  const iVisionTotal = idx("vision_total_tokens");
  const iToolCalls = idx("tool_calls");
  const iToolBy = idx("tool_calls_by_name_json");

  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const date = cols[iDate] ?? "";
    const chatRaw = cols[iChat] ?? "";
    const groupId = cols[iGroup] ? String(cols[iGroup]) : undefined;
    const userId = cols[iUser] ? String(cols[iUser]) : "";
    if (!date || !chatRaw || !userId) continue;
    const chatType: "private" | "group" = chatRaw === "private" ? "private" : "group";

    const toolCallsByName = safeParseJson<Record<string, number>>(cols[iToolBy] ?? "") ?? {};
    const rec: DailyUserStats = {
      date,
      chatType,
      groupId: groupId || undefined,
      userId,
      llmCalls: Number(cols[iLlmCalls] ?? 0) || 0,
      llmPromptTokens: Number(cols[iLlmPrompt] ?? 0) || 0,
      llmCompletionTokens: Number(cols[iLlmComp] ?? 0) || 0,
      llmTotalTokens: Number(cols[iLlmTotal] ?? 0) || 0,
      visionCalls: Number(cols[iVisionCalls] ?? 0) || 0,
      visionPromptTokens: Number(cols[iVisionPrompt] ?? 0) || 0,
      visionCompletionTokens: Number(cols[iVisionComp] ?? 0) || 0,
      visionTotalTokens: Number(cols[iVisionTotal] ?? 0) || 0,
      toolCalls: Number(cols[iToolCalls] ?? 0) || 0,
      toolCallsByName
    };
    map.set(keyOf({ date, chatType: rec.chatType, userId: rec.userId, groupId: rec.groupId }), rec);
  }
  return map;
}

function writeCsv(filePath: string, records: Map<string, DailyUserStats>): void {
  const rows: string[] = [];
  rows.push(
    [
      "date",
      "chat_type",
      "group_id",
      "user_id",
      "llm_calls",
      "llm_prompt_tokens",
      "llm_completion_tokens",
      "llm_total_tokens",
      "vision_calls",
      "vision_prompt_tokens",
      "vision_completion_tokens",
      "vision_total_tokens",
      "tool_calls",
      "tool_calls_by_name_json"
    ].join(",")
  );

  const list = [...records.values()].sort((a, b) => {
    if (a.chatType !== b.chatType) return a.chatType.localeCompare(b.chatType);
    if ((a.groupId ?? "") !== (b.groupId ?? "")) return String(a.groupId ?? "").localeCompare(String(b.groupId ?? ""));
    return a.userId.localeCompare(b.userId);
  });

  for (const r of list) {
    rows.push(
      [
        csvEscape(r.date),
        csvEscape(r.chatType),
        csvEscape(r.groupId ?? ""),
        csvEscape(r.userId),
        r.llmCalls,
        r.llmPromptTokens,
        r.llmCompletionTokens,
        r.llmTotalTokens,
        r.visionCalls,
        r.visionPromptTokens,
        r.visionCompletionTokens,
        r.visionTotalTokens,
        r.toolCalls,
        csvEscape(JSON.stringify(r.toolCallsByName ?? {}))
      ].join(",")
    );
  }

  atomicWriteText(filePath, rows.join("\n") + "\n");
}

export class StatsStore {
  private readonly statsDir: string;
  private readonly lockDir: string;

  constructor(private readonly config: AppConfig) {
    this.statsDir = config.STATS_DIR ? String(config.STATS_DIR) : path.join(config.DATA_DIR, "stats");
    this.lockDir = path.join(config.DATA_DIR, "stats.locks");
  }

  private csvPath(date: string): string {
    return path.join(this.statsDir, `${date}.csv`);
  }

  private lockPath(date: string): string {
    return path.join(this.lockDir, `${date}.lock`);
  }

  private async withDateLock<T>(date: string, fn: () => T | Promise<T>): Promise<T> {
    ensureDir(this.lockDir);
    const p = this.lockPath(date);
    const staleMs = 30_000;

    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const fd = fs.openSync(p, "wx");
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf8");
        fs.closeSync(fd);
        try {
          return await fn();
        } finally {
          try {
            fs.unlinkSync(p);
          } catch {}
        }
      } catch {
        try {
          const st = fs.statSync(p);
          if (Date.now() - st.mtimeMs > staleMs) {
            fs.unlinkSync(p);
            continue;
          }
        } catch {}
        await sleep(20 + attempt * 20);
      }
    }

    return await fn();
  }

  async recordLlm(scope: StatsScope, usage?: TokenUsage): Promise<void> {
    await this.withDateLock(scope.date, () => {
      ensureDir(this.statsDir);
      const pCsv = this.csvPath(scope.date);
      const records = parseCsv(pCsv);
      const k = keyOf(scope);
      const rec =
        records.get(k) ??
        ({
          date: scope.date,
          chatType: scope.chatType,
          userId: scope.userId,
          groupId: scope.groupId,
          llmCalls: 0,
          llmPromptTokens: 0,
          llmCompletionTokens: 0,
          llmTotalTokens: 0,
          visionCalls: 0,
          visionPromptTokens: 0,
          visionCompletionTokens: 0,
          visionTotalTokens: 0,
          toolCalls: 0,
          toolCallsByName: {}
        } as DailyUserStats);
      records.set(k, rec);
      rec.llmCalls += 1;
      if (usage) {
        rec.llmPromptTokens += Math.max(0, usage.promptTokens ?? 0);
        rec.llmCompletionTokens += Math.max(0, usage.completionTokens ?? 0);
        rec.llmTotalTokens += Math.max(0, usage.totalTokens ?? 0);
      }
      writeCsv(pCsv, records);
    });
  }

  async recordVision(scope: StatsScope, usage?: TokenUsage): Promise<void> {
    await this.withDateLock(scope.date, () => {
      ensureDir(this.statsDir);
      const pCsv = this.csvPath(scope.date);
      const records = parseCsv(pCsv);
      const k = keyOf(scope);
      const rec =
        records.get(k) ??
        ({
          date: scope.date,
          chatType: scope.chatType,
          userId: scope.userId,
          groupId: scope.groupId,
          llmCalls: 0,
          llmPromptTokens: 0,
          llmCompletionTokens: 0,
          llmTotalTokens: 0,
          visionCalls: 0,
          visionPromptTokens: 0,
          visionCompletionTokens: 0,
          visionTotalTokens: 0,
          toolCalls: 0,
          toolCallsByName: {}
        } as DailyUserStats);
      records.set(k, rec);
      rec.visionCalls += 1;
      if (usage) {
        rec.visionPromptTokens += Math.max(0, usage.promptTokens ?? 0);
        rec.visionCompletionTokens += Math.max(0, usage.completionTokens ?? 0);
        rec.visionTotalTokens += Math.max(0, usage.totalTokens ?? 0);
      }
      writeCsv(pCsv, records);
    });
  }

  async recordToolCall(scope: StatsScope, toolName: string): Promise<void> {
    const name = String(toolName ?? "").trim() || "unknown";
    await this.withDateLock(scope.date, () => {
      ensureDir(this.statsDir);
      const pCsv = this.csvPath(scope.date);
      const records = parseCsv(pCsv);
      const k = keyOf(scope);
      const rec =
        records.get(k) ??
        ({
          date: scope.date,
          chatType: scope.chatType,
          userId: scope.userId,
          groupId: scope.groupId,
          llmCalls: 0,
          llmPromptTokens: 0,
          llmCompletionTokens: 0,
          llmTotalTokens: 0,
          visionCalls: 0,
          visionPromptTokens: 0,
          visionCompletionTokens: 0,
          visionTotalTokens: 0,
          toolCalls: 0,
          toolCallsByName: {}
        } as DailyUserStats);
      records.set(k, rec);
      rec.toolCalls += 1;
      rec.toolCallsByName[name] = (rec.toolCallsByName[name] ?? 0) + 1;
      writeCsv(pCsv, records);
    });
  }

  getUserStats(date: string, scope: { chatType: "private" | "group"; userId: string; groupId?: string }): DailyUserStats | null {
    const pCsv = this.csvPath(date);
    const records = parseCsv(pCsv);
    const k: StatsScope = { date, chatType: scope.chatType, userId: scope.userId, groupId: scope.groupId };
    return records.get(keyOf(k)) ?? null;
  }

  getTodayCsvPath(nowMs = Date.now()): string {
    return this.csvPath(formatDateLocal(nowMs));
  }
}
