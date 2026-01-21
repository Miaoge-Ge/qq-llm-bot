import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

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

  EMBEDDING_MODEL: z.string().optional(),

  DATA_DIR: z.string().default("data"),
  KNOWLEDGE_DIR: z.string().default("knowledge"),

  GROUP_REPLY_MODE: z.enum(["mention", "keyword", "all"]).default("mention"),
  GROUP_KEYWORDS: z.preprocess(parseStringArray, z.array(z.string()).default(["机器人"])),

  MAX_SHORT_MEMORY_TURNS: z.coerce.number().int().min(1).max(100).default(20)
});

export type AppConfig = z.infer<typeof envSchema>;

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
    const abs = path.isAbsolute(promptFile) ? promptFile : path.join(process.cwd(), promptFile);
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
  const botName = (cfg.BOT_NAME ?? "").trim();
  if (botName && !cfg.GROUP_KEYWORDS.includes(botName)) {
    cfg.GROUP_KEYWORDS = [botName, ...cfg.GROUP_KEYWORDS];
  }
  return cfg;
}

