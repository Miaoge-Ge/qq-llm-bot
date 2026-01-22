import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerGetDateTool(server: McpServer): void {
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
}

