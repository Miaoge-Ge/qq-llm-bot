import "dotenv/config";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

function env(name: string): string | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  return v.trim();
}

function generateSeniverseSignature(publicKey: string, privateKey: string, ttl = 300): string {
  const ts = Math.floor(Date.now() / 1000);
  const params = `ts=${ts}&ttl=${ttl}&uid=${publicKey}`;
  const digest = crypto.createHmac("sha1", privateKey).update(params).digest("base64");
  const sig = encodeURIComponent(digest);
  return `${params}&sig=${sig}`;
}

const server = new McpServer({ name: "my-tools", version: "0.1.0" });

server.registerTool(
  "get_model_name",
  {
    title: "Get Model Name",
    description: "获取当前使用的语言模型的名称",
    inputSchema: {}
  },
  async () => {
    const modelName = env("MODEL_NAME") ?? env("LLM_MODEL") ?? "deepseek-v3";
    if (!modelName.trim()) throw new Error("错误：模型名称未配置或无效");
    return { content: [{ type: "text", text: modelName }] };
  }
);

server.registerTool(
  "get_date",
  {
    title: "Get Date Detail",
    description: "获取当前日期的详细信息",
    inputSchema: {}
  },
  async () => {
    const now = new Date();
    const weekdayCn = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][now.getDay()];
    const start = new Date(now.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86400000) + 1;
    const payload = {
      date: now.toISOString().slice(0, 10),
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      weekday: now.toLocaleDateString("en-US", { weekday: "long" }),
      weekday_cn: weekdayCn,
      day_of_year: dayOfYear
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }
);

server.registerTool(
  "weather_query",
  {
    title: "Weather Query",
    description: "获取指定城市当前天气（需要配置 SENIVERSE_PUBLIC_KEY / SENIVERSE_PRIVATE_KEY）",
    inputSchema: { location: z.string().min(1) }
  },
  async ({ location }: { location: string }) => {
    const loc = String(location ?? "").trim();
    if (!loc) return { content: [{ type: "text", text: "错误：城市名称不能为空或无效" }] };

    const publicKey = env("SENIVERSE_PUBLIC_KEY");
    const privateKey = env("SENIVERSE_PRIVATE_KEY");
    if (!publicKey || !privateKey) {
      return {
        content: [
          {
            type: "text",
            text: "缺少心知天气配置：请设置环境变量 SENIVERSE_PUBLIC_KEY 和 SENIVERSE_PRIVATE_KEY"
          }
        ]
      };
    }

    const signature = generateSeniverseSignature(publicKey, privateKey);
    const baseUrl = "https://api.seniverse.com/v3/weather/now.json";
    const params = new URLSearchParams({
      location: loc,
      language: "zh-Hans",
      unit: "c"
    });
    const fullUrl = `${baseUrl}?${params.toString()}&${signature}`;

    try {
      const res = await fetch(fullUrl, { method: "GET" });
      const data: any = await res.json().catch(() => undefined);
      if (!res.ok) {
        return { content: [{ type: "text", text: `请求天气失败：HTTP ${res.status} ${JSON.stringify(data)}` }] };
      }

      const results = data?.results;
      if (!Array.isArray(results) || results.length === 0) {
        return { content: [{ type: "text", text: `未获取到 ${loc} 的天气信息` }] };
      }

      const now = results[0]?.now ?? {};
      const city = results[0]?.location?.name ?? loc;
      const weatherText = now.text ?? "未知天气";
      const temperature = now.temperature ?? "未知温度";
      return { content: [{ type: "text", text: `${city} 当前天气：${weatherText}，气温 ${temperature}°C` }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `请求天气失败：${String(e?.message ?? e)}` }] };
    }
  }
);

async function trySerperSearch(apiKey: string, query: string): Promise<string> {
  const payload = { q: query, gl: "us", hl: "en", num: 5 };
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
  const lines = results.slice(0, 5).map((r: any) => `${r?.title ?? "无标题"} - ${r?.snippet ?? "无摘要"}`);
  return `搜索结果：\n${lines.join("\n")}`;
}

async function trySearch1Api(apiKey: string, query: string): Promise<string> {
  const host = env("SEARCH_API_HOST") ?? "api.search1api.com";
  const url = `https://${host}/search`;
  const payload = {
    query,
    search_service: "google",
    max_results: 5,
    crawl_results: 2,
    image: false,
    include_sites: ["forbes.com", "technologyreview.com"],
    exclude_sites: ["wikipedia.org"],
    language: "en",
    time_range: "month"
  };
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
  const lines = results.slice(0, 5).map((r: any) => `${r?.title ?? "无标题"} - ${(r?.snippet ?? r?.description ?? "无摘要") as string}`);
  return `搜索结果：\n${lines.join("\n")}`;
}

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

    const search1Key = env("SEARCH_API_KEY");
    if (search1Key) {
      try {
        const text = await trySearch1Api(search1Key, q);
        return { content: [{ type: "text", text }] };
      } catch (e: any) {
        errors.push(String(e?.message ?? e));
      }
    }

    const serperKey = env("SERPER_API_KEY");
    if (serperKey) {
      try {
        const text = await trySerperSearch(serperKey, q);
        return { content: [{ type: "text", text }] };
      } catch (e: any) {
        errors.push(String(e?.message ?? e));
      }
    }

    const hint = !search1Key && !serperKey ? "缺少 SEARCH_API_KEY / SERPER_API_KEY，无法联网搜索" : `搜索失败：\n${errors.join("\n")}`;
    return { content: [{ type: "text", text: hint }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
