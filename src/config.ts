import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { projectRootDir, resolveFromProjectRoot } from "./utils/fs.js";

function normalizeSecret(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  const m1 = s.match(/^["']([\s\S]*)["']$/);
  const v1 = (m1 ? m1[1] : s).trim();
  const m2 = v1.match(/^`([\s\S]*)`$/);
  return (m2 ? m2[1] : v1).trim();
}

function parseStringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map((x) => String(x)).map((s) => s.trim()).filter(Boolean);
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x)).map((t) => t.trim()).filter(Boolean);
    } catch {}
  }
  return s
    .split(/[,\s]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

const envSchema = z.object({
  NAPCAT_HTTP_URL: z.string().url().default("http://127.0.0.1:3000"),
  NAPCAT_WS_URL: z.string().url().default("ws://127.0.0.1:3001"),
  NAPCAT_ACCESS_TOKEN: z.preprocess(normalizeSecret, z.string().min(1)).optional(),
  NAPCAT_HTTP_TOKEN: z.preprocess(normalizeSecret, z.string().min(1)).optional(),
  NAPCAT_WS_TOKEN: z.preprocess(normalizeSecret, z.string().min(1)).optional(),
  BOT_QQ_ID: z.string().optional(),
  BOT_NAME: z.preprocess(normalizeSecret, z.string().min(1)).default("小助手"),

  LLM_BASE_URL: z.preprocess(normalizeSecret, z.string().url()).default("https://api.deepseek.com/v1"),
  LLM_API_KEY: z.preprocess(normalizeSecret, z.string().min(1)).optional(),
  LLM_MODEL: z.string().default("deepseek-chat"),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.3),

  VISION_BASE_URL: z.preprocess(normalizeSecret, z.string().url()).default("https://dashscope.aliyuncs.com/compatible-mode/v1"),
  VISION_API_KEY: z.preprocess(normalizeSecret, z.string().min(1)).optional(),
  VISION_MODEL: z.preprocess(normalizeSecret, z.string().min(1)).default("qwen3-vl-plus"),

  SYSTEM_PROMPT: z.preprocess(normalizeSecret, z.string().min(1)).optional(),
  SYSTEM_PROMPT_FILE: z.preprocess(normalizeSecret, z.string().min(1)).optional(),

  DATA_DIR: z.string().default("data"),
  STATS_DIR: z.string().optional(),

  GROUP_REPLY_MODE: z.enum(["mention", "keyword", "all"]).default("mention"),
  GROUP_KEYWORDS: z.preprocess(parseStringArray, z.array(z.string()).default(["机器人"])),
  GROUP_FOLLOWUP_TURNS: z.coerce.number().int().min(0).max(20).default(4),
  GROUP_FOLLOWUP_TTL_MS: z.coerce.number().int().min(0).max(3_600_000).default(120000),

  TOOL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000)
});

export type AppConfig = z.infer<typeof envSchema>;

type OneBot11Config = {
  network?: {
    httpServers?: { enable?: boolean; port?: number; token?: string }[];
    websocketServers?: { enable?: boolean; port?: number; token?: string }[];
  };
};

function parsePortFromUrl(url: string): number | null {
  try {
    const u = new URL(url);
    if (u.port) return parseInt(u.port, 10);
    if (u.protocol === "http:" || u.protocol === "ws:") return 80;
    if (u.protocol === "https:" || u.protocol === "wss:") return 443;
    return null;
  } catch {
    return null;
  }
}

function maybeLoadNapCatTokensFromLocalOneBotConfig(cfg: AppConfig): void {
  if (cfg.NAPCAT_HTTP_TOKEN && cfg.NAPCAT_WS_TOKEN) return;

  const candidates = [
    "/opt/napcat-home/Napcat/opt/QQ/resources/app/app_launcher/napcat/config/onebot11.json"
  ];

  let raw: string | null = null;
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      raw = fs.readFileSync(p, "utf8");
      break;
    } catch {}
  }
  if (!raw) return;

  let parsed: OneBot11Config | null = null;
  try {
    parsed = JSON.parse(raw) as OneBot11Config;
  } catch {
    return;
  }

  const httpPort = parsePortFromUrl(cfg.NAPCAT_HTTP_URL);
  const wsPort = parsePortFromUrl(cfg.NAPCAT_WS_URL);

  if (!cfg.NAPCAT_HTTP_TOKEN) {
    const servers = parsed?.network?.httpServers ?? [];
    const enabled = servers.filter((s) => s.enable !== false);
    const matched = httpPort ? enabled.find((s) => s.port === httpPort) : undefined;
    const token = (matched?.token ?? enabled[0]?.token ?? "").trim();
    if (token) cfg.NAPCAT_HTTP_TOKEN = token;
  }

  if (!cfg.NAPCAT_WS_TOKEN) {
    const servers = parsed?.network?.websocketServers ?? [];
    const enabled = servers.filter((s) => s.enable !== false);
    const matched = wsPort ? enabled.find((s) => s.port === wsPort) : undefined;
    const token = (matched?.token ?? enabled[0]?.token ?? "").trim();
    if (token) cfg.NAPCAT_WS_TOKEN = token;
  }
}

export function loadConfig(): AppConfig {
  const env = { ...process.env } as Record<string, unknown>;
  if (!env.GROUP_KEYWORDS && env.GROUP_KEYWORD) env.GROUP_KEYWORDS = env.GROUP_KEYWORD;
  if (!env.LLM_API_KEY && env.OPENAI_API_KEY) env.LLM_API_KEY = env.OPENAI_API_KEY;
  if (env.NAPCAT_ACCESS_TOKEN) {
    if (!env.NAPCAT_HTTP_TOKEN) env.NAPCAT_HTTP_TOKEN = env.NAPCAT_ACCESS_TOKEN;
    if (!env.NAPCAT_WS_TOKEN) env.NAPCAT_WS_TOKEN = env.NAPCAT_ACCESS_TOKEN;
  }

  const promptFile = normalizeSecret(env.SYSTEM_PROMPT_FILE) as string | undefined;
  const promptInline = normalizeSecret(env.SYSTEM_PROMPT) as string | undefined;
  if (promptFile && !promptInline) {
    const abs = resolveFromProjectRoot(promptFile);
    try {
      env.SYSTEM_PROMPT = fs.readFileSync(abs, "utf8");
    } catch {
      throw new Error(`配置错误:\nSYSTEM_PROMPT_FILE: 无法读取文件 ${abs}`);
    }
  }

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`配置错误:\n${issues}`);
  }
  const cfg = parsed.data;
  cfg.DATA_DIR = path.isAbsolute(cfg.DATA_DIR) ? cfg.DATA_DIR : path.resolve(projectRootDir(), cfg.DATA_DIR);
  if (cfg.STATS_DIR) cfg.STATS_DIR = path.isAbsolute(cfg.STATS_DIR) ? cfg.STATS_DIR : path.resolve(projectRootDir(), cfg.STATS_DIR);
  const botName = (cfg.BOT_NAME ?? "").trim();
  if (botName && !cfg.GROUP_KEYWORDS.includes(botName)) {
    cfg.GROUP_KEYWORDS = [botName, ...cfg.GROUP_KEYWORDS];
  }
  maybeLoadNapCatTokensFromLocalOneBotConfig(cfg);
  return cfg;
}
