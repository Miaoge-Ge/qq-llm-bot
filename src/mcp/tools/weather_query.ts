import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env, generateSeniverseSignature } from "./helpers.js";

export function registerWeatherQueryTool(server: McpServer): void {
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
}

