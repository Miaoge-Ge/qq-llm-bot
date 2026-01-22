import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { env } from "./helpers.js";

export function registerGetModelNameTool(server: McpServer): void {
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
}

