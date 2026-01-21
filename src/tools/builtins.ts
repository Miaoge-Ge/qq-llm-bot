import type { RagStore } from "../rag/ragStore.js";
import type { MemoryStore } from "../memory/memoryStore.js";
import type { ChatEvent } from "../types.js";

export type BuiltinToolContext = {
  evt: ChatEvent;
  scopeKeys: string[];
  rag: RagStore;
  memory: MemoryStore;
};

export type BuiltinTool = {
  name: string;
  description: string;
  run: (args: Record<string, unknown>, ctx: BuiltinToolContext) => Promise<string>;
};

export function builtinTools(): BuiltinTool[] {
  return [
    {
      name: "rag_search",
      description: "在当前会话作用域内检索知识库片段",
      run: async (args, ctx) => {
        const q = String(args.query ?? "").trim();
        const topK = Number(args.top_k ?? 5);
        const chunks = await ctx.rag.retrieve({ scopeKeys: ctx.scopeKeys, query: q, topK: Number.isFinite(topK) ? topK : 5 });
        if (!chunks.length) return "未检索到相关片段";
        return chunks
          .map((c, i) => `[#${i + 1}] ${c.source}\n${c.text}`)
          .join("\n\n")
          .trim();
      }
    }
  ];
}

