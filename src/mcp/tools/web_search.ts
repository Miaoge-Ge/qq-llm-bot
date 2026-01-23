import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env } from "./helpers.js";

async function trySerperSearch(apiKey: string, query: string, opts: { preferZh: boolean }): Promise<string> {
  const payload = { q: query, gl: opts.preferZh ? "cn" : "us", hl: opts.preferZh ? "zh-cn" : "en", num: 5 };
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey
    },
    body: JSON.stringify(payload)
  });
  const json: any = await res.json().catch(() => undefined);
  if (!res.ok) throw new Error(`Serper: HTTP ${res.status} ${JSON.stringify(json)}`);
  const results = Array.isArray(json?.organic) ? json.organic : [];
  if (!results.length) return `未找到与 '${query}' 相关的搜索结果。`;
  const lines = results
    .slice(0, 5)
    .filter((r: any) => {
      const link = String(r?.link ?? "").toLowerCase();
      if (!link) return true;
      if (link.includes("tophub.")) return false;
      return true;
    })
    .map((r: any) => `${r?.title ?? "无标题"} - ${r?.snippet ?? "无摘要"}${r?.link ? ` (${r.link})` : ""}`);
  return `搜索结果：\n${lines.join("\n")}`;
}

async function trySearch1Api(apiKey: string, query: string, opts: { preferZh: boolean }): Promise<string> {
  const host = env("SEARCH_API_HOST") ?? "api.search1api.com";
  const url = `https://${host}/search`;
  const payload: Record<string, unknown> = {
    query,
    search_service: "google",
    max_results: 8,
    crawl_results: 2,
    image: false,
    language: opts.preferZh ? "zh" : "en",
    time_range: "month"
  };
  payload.exclude_sites = ["wikipedia.org", "tophub.today", "tophub.link", "tophub.fun"];
  if (opts.preferZh && /(新闻|热搜|要闻|摘要|热点)/.test(query)) {
    payload.include_sites = [
      "news.sina.com.cn",
      "news.qq.com",
      "cctv.com",
      "xinhuanet.com",
      "people.com.cn",
      "chinanews.com.cn",
      "thepaper.cn",
      "guancha.cn"
    ];
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });
  const json: any = await res.json().catch(() => undefined);
  if (!res.ok) throw new Error(`Search1API: HTTP ${res.status} ${JSON.stringify(json)}`);
  const results =
    (Array.isArray(json?.results) ? json.results : null) ??
    (Array.isArray(json?.organic_results) ? json.organic_results : null) ??
    (Array.isArray(json?.data) ? json.data : null) ??
    (Array.isArray(json?.search_results) ? json.search_results : null) ??
    [];
  if (!results.length) return `未找到与 '${query}' 相关的搜索结果。`;
  const lines = results
    .slice(0, 5)
    .map(
      (r: any) =>
        `${r?.title ?? "无标题"} - ${(r?.snippet ?? r?.description ?? "无摘要") as string}${r?.link ? ` (${r.link})` : ""}`
    );
  return `搜索结果：\n${lines.join("\n")}`;
}

function normalizeQueries(q: string): string[] {
  const raw = String(q ?? "").trim();
  if (!raw) return [];
  const variants = [raw];
  const noSuffix = raw.replace(/(?:的)?(?:趣事|八卦|梗|故事|名场面|集锦)\s*$/g, "").trim();
  if (noSuffix && noSuffix !== raw) variants.push(noSuffix);
  const compact = noSuffix.replace(/\s+/g, " ").trim();
  if (compact && compact !== noSuffix) variants.push(compact);
  return [...new Set(variants)].slice(0, 3);
}

export function registerWebSearchTool(server: McpServer): void {
  server.registerTool(
    "web_search",
    {
      title: "Web Search",
      description: "联网搜索（优先 Search1API，其次 Serper）",
      inputSchema: { query: z.string().min(1) }
    },
    async ({ query }: { query: string }) => {
      const q = String(query ?? "").trim();
      if (!q) return { content: [{ type: "text", text: "错误：搜索查询不能为空或无效。" }] };

      const errors: string[] = [];
      const hasCjk = /[\u4e00-\u9fff]/.test(q);
      const hasLatin = /[A-Za-z]/.test(q);
      const queryVariants = normalizeQueries(q);
      const langs = hasCjk && hasLatin ? [true, false] : [hasCjk];

      const search1Key = env("SEARCH_API_KEY");
      if (search1Key) {
        for (const qq of queryVariants) {
          for (const preferZh of langs) {
            try {
              const text = await trySearch1Api(search1Key, qq, { preferZh });
              if (!text.includes("未找到与")) return { content: [{ type: "text", text }] };
            } catch (e: any) {
              errors.push(String(e?.message ?? e));
            }
          }
        }
      }

      const serperKey = env("SERPER_API_KEY");
      if (serperKey) {
        for (const qq of queryVariants) {
          for (const preferZh of langs) {
            try {
              const text = await trySerperSearch(serperKey, qq, { preferZh });
              if (!text.includes("未找到与")) return { content: [{ type: "text", text }] };
            } catch (e: any) {
              errors.push(String(e?.message ?? e));
            }
          }
        }
      }

      const hint = !search1Key && !serperKey ? "缺少 SEARCH_API_KEY / SERPER_API_KEY，无法联网搜索" : `搜索失败：\n${errors.join("\n")}`;
      return { content: [{ type: "text", text: hint }] };
    }
  );
}
