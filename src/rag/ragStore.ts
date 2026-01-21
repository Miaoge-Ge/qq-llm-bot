import path from "node:path";
import crypto from "node:crypto";
import type { AppConfig } from "../config.js";
import { readJsonl, appendJsonl } from "../utils/jsonl.js";
import { resolveFromCwd } from "../utils/fs.js";
import type { OpenAiCompatClient } from "../llm/openaiCompat.js";

export type RagChunk = {
  id: string;
  scopeKey: string;
  source: string;
  text: string;
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

export class RagStore {
  private readonly chunksFile: string;
  private chunks: RagChunk[];

  constructor(
    private readonly config: AppConfig,
    private readonly llm: OpenAiCompatClient
  ) {
    const dataDir = resolveFromCwd(config.DATA_DIR);
    this.chunksFile = path.join(dataDir, "rag_chunks.jsonl");
    this.chunks = readJsonl<RagChunk>(this.chunksFile);
  }

  async addChunk(opts: { scopeKey: string; source: string; text: string; timestampMs: number }): Promise<void> {
    const id = crypto.randomUUID();
    const rec: RagChunk = { id, scopeKey: opts.scopeKey, source: opts.source, text: opts.text, timestampMs: opts.timestampMs };
    if (this.config.EMBEDDING_MODEL && this.config.LLM_API_KEY) {
      rec.embedding = await this.llm.embed({ model: this.config.EMBEDDING_MODEL, input: opts.text });
    }
    this.chunks.push(rec);
    appendJsonl(this.chunksFile, rec);
  }

  async retrieve(opts: { scopeKeys: string[]; query: string; topK: number }): Promise<RagChunk[]> {
    const pool = this.chunks.filter((c) => opts.scopeKeys.includes(c.scopeKey));
    if (!pool.length) return [];

    if (this.config.EMBEDDING_MODEL && this.config.LLM_API_KEY) {
      const q = await this.llm.embed({ model: this.config.EMBEDDING_MODEL, input: opts.query });
      return pool
        .filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0)
        .map((c) => ({ c, score: cosineSimilarity(q, c.embedding!) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, opts.topK)
        .map((x) => x.c);
    }

    const q = opts.query.trim();
    return pool.filter((c) => c.text.includes(q)).slice(0, opts.topK);
  }
}

