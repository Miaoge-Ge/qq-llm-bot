import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { loadConfig } from "../config.js";
import { OpenAiCompatClient } from "../llm/openaiCompat.js";
import { RagStore } from "../rag/ragStore.js";
import { resolveFromCwd } from "../utils/fs.js";

function chunkText(text: string, maxLen = 800): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  const out: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    out.push(cleaned.slice(i, i + maxLen));
    i += maxLen;
  }
  return out;
}

const config = loadConfig();
const llm = new OpenAiCompatClient(config.LLM_BASE_URL, config.LLM_API_KEY);
const rag = new RagStore(config, llm);

const knowledgeDir = resolveFromCwd(process.argv[2] ?? config.KNOWLEDGE_DIR);
if (!fs.existsSync(knowledgeDir)) {
  console.error(`知识目录不存在: ${knowledgeDir}`);
  process.exit(1);
}

const files = fs
  .readdirSync(knowledgeDir)
  .filter((f: string) => /\.(md|txt)$/i.test(f))
  .map((f: string) => path.join(knowledgeDir, f));

for (const f of files) {
  const content = fs.readFileSync(f, "utf8");
  const chunks = chunkText(content);
  for (const c of chunks) {
    await rag.addChunk({
      scopeKey: "global",
      source: path.basename(f),
      text: c,
      timestampMs: Date.now()
    });
  }
  console.log(`已导入: ${path.basename(f)} (${chunks.length} chunks)`);
}

