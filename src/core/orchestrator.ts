import type { AppConfig } from "../config.js";
import type { ChatEvent, SendMessage } from "../types.js";
import type { OpenAiCompatClient, LlmMessage, LlmRichMessage } from "../llm/openaiCompat.js";
import type { MemoryStore } from "../memory/memoryStore.js";
import type { RagStore } from "../rag/ragStore.js";
import type { McpRegistry } from "../mcp/registry.js";
import { builtinTools } from "../tools/builtins.js";
import { parseToolCallFromText } from "../utils/toolCall.js";

function formatMemory(memories: { content: string }[]): string {
  if (!memories.length) return "";
  return memories.map((m) => `- ${m.content}`).join("\n");
}

function formatRag(chunks: { source: string; text: string }[]): string {
  if (!chunks.length) return "";
  return chunks.map((c, i) => `[#${i + 1}] ${c.source}\n${c.text}`).join("\n\n");
}

export class Orchestrator {
  private readonly builtins = builtinTools();

  constructor(
    private readonly config: AppConfig,
    private readonly llm: OpenAiCompatClient,
    private readonly vision: OpenAiCompatClient,
    private readonly memory: MemoryStore,
    private readonly rag: RagStore,
    private readonly mcp: McpRegistry
  ) {}

  async handle(
    evt: ChatEvent,
    target: SendMessage["target"],
    cleanedText: string,
    opts?: { imageDataUrls?: string[] }
  ): Promise<SendMessage> {
    const conversationId = this.memory.conversationId(evt.chatType, evt.userId, evt.groupId);
    const scopeKeys = this.memory.scopeKeysFor(evt.chatType, evt.userId, evt.groupId);

    if (cleanedText.startsWith("/记住 ")) {
      const content = cleanedText.slice("/记住 ".length).trim();
      const scopeKey = evt.chatType === "private" ? `user:${evt.userId}` : `group_user:${evt.groupId}:${evt.userId}`;
      if (content) await this.memory.addLongMemory({ scopeKey, content, timestampMs: Date.now() });
      return { target, text: content ? "已记住" : "内容为空" };
    }

    const directToolCall = parseToolCallFromText(cleanedText);
    if (directToolCall) {
      const toolResult = await this.executeTool(directToolCall.tool, directToolCall.arguments ?? {}, { evt, scopeKeys });
      return { target, text: toolResult || "工具无输出" };
    }

    const imageDataUrls = (opts?.imageDataUrls ?? []).filter(Boolean).slice(0, 3);
    if (imageDataUrls.length) {
      if (!this.config.VISION_API_KEY) {
        return {
          target,
          text:
            "未配置识图模型的 VISION_API_KEY。\n\n请在 .env 里添加：\nVISION_BASE_URL=你的OpenAI兼容网关\nVISION_API_KEY=你的key\nVISION_MODEL=Qwen/Qwen2-VL-72B-Instruct(或其它多模态模型)\n\n改完后重启进程。"
        };
      }
      const userText = cleanedText.trim() || "请描述这张图片，并指出关键细节。";
      const content: Array<Record<string, unknown>> = [{ type: "text", text: userText }];
      for (const d of imageDataUrls) content.push({ type: "image_url", image_url: { url: d } });

      const messages: LlmRichMessage[] = [
        {
          role: "system",
          content:
            evt.chatType === "group"
              ? `你的昵称是${this.config.BOT_NAME}。你在群聊里识图回答：尽量短一点，抓重点，不要刷屏。`
              : `你的昵称是${this.config.BOT_NAME}。你在私聊里识图回答：表达自然清晰，重点突出。`
        },
        { role: "user", content }
      ];

      let finalText = "";
      try {
        finalText = (
          await this.vision.chatCompletionsRich({
            model: this.config.VISION_MODEL,
            temperature: 0.2,
            messages
          })
        ).trim();
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        if (msg.includes("unknown variant `image_url`") || msg.includes("expected `text`")) {
          return {
            target,
            text:
              "当前识图网关不支持 OpenAI 兼容的 image_url 格式（只接受纯文本），所以图片无法解析。\n\n请在 .env 里配置：\nVISION_BASE_URL=支持多模态的 OpenAI 兼容网关\nVISION_API_KEY=key\nVISION_MODEL=多模态模型名（如 Qwen2-VL）\n\n改完后重启。"
          };
        }
        return {
          target,
          text: `识图失败：${msg}\n\n当前配置：\nVISION_BASE_URL=${this.config.VISION_BASE_URL}\nVISION_MODEL=${this.config.VISION_MODEL}`
        };
      }

      this.memory.addMessage({
        conversationId,
        role: "user",
        content: cleanedText || "[image]",
        timestampMs: Date.now(),
        messageId: evt.messageId
      });
      this.memory.addMessage({
        conversationId,
        role: "assistant",
        content: finalText,
        timestampMs: Date.now()
      });

      return { target, text: finalText || "我看到了图片，但没有识别出可用信息。" };
    }

    if (!this.config.LLM_API_KEY) {
      return {
        target,
        text:
          "未配置 LLM_API_KEY。\n\n请在项目根目录 .env 里添加：\nLLM_API_KEY=你的key\nLLM_BASE_URL=你的OpenAI兼容网关(可选)\nLLM_MODEL=模型名(可选)\n\n改完后重启进程。"
      };
    }

    const recent = this.memory.recentMessages(conversationId, this.config.MAX_SHORT_MEMORY_TURNS);
    const longMem = await this.memory.searchLongMemory(scopeKeys, cleanedText, 6);
    const ragChunks = await this.rag.retrieve({ scopeKeys, query: cleanedText, topK: 6 });

    const systemParts: string[] = [
      `你的昵称是${this.config.BOT_NAME}。`,
      "你是一个 QQ 聊天机器人。用自然、口语化的中文交流，避免官腔和模板化。",
      "优先给出可执行的结论；信息不足就先问 1 个关键问题再继续。",
      evt.chatType === "group"
        ? "当前在群聊：尽量短一点，别刷屏；除非对方追问，否则不要长篇大论。"
        : "当前在私聊：可以更细致一些，但仍然保持清晰和简洁。",
      "不要编造事实；如果需要外部信息就用工具或说明无法确定。"
    ];

    if (this.config.SYSTEM_PROMPT?.trim()) systemParts.push(this.config.SYSTEM_PROMPT.trim());

    const memText = formatMemory(longMem);
    if (memText) systemParts.push(`长期记忆:\n${memText}`);

    const ragText = formatRag(ragChunks);
    if (ragText) systemParts.push(`知识库证据:\n${ragText}\n\n要求：仅在确有帮助时引用证据，不要编造来源。`);

    const toolCatalog = [
      ...this.builtins.map((t) => ({ name: t.name, description: t.description })),
      ...this.mcp.listTools().map((t) => ({ name: `${t.server}::${t.name}`, description: t.description ?? "" }))
    ]
      .filter((t) => t.name && t.description)
      .slice(0, 50)
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");

    if (toolCatalog) {
      systemParts.push(
        `你可以使用工具来获得准确信息。\n- 若要调用工具：只输出一行 JSON（不要多余文本），格式：{"tool":"<name>","arguments":{...}}\n- 若不调用工具：直接输出给用户的自然回复\n可用工具:\n${toolCatalog}`
      );
    }

    const messages: LlmMessage[] = [{ role: "system", content: systemParts.join("\n\n") }];

    for (const m of recent) {
      messages.push({ role: m.role, content: m.content });
    }
    messages.push({ role: "user", content: cleanedText });

    const first = (await this.llm.chatCompletions({
      model: this.config.LLM_MODEL,
      temperature: this.config.LLM_TEMPERATURE,
      messages
    })).trim();

    const toolCall = parseOneLineJson(first);
    let finalText = first;

    if (toolCall) {
      const toolResult = await this.executeTool(toolCall.tool, toolCall.arguments ?? {}, { evt, scopeKeys });
      const followup: LlmMessage[] = [
        ...messages,
        { role: "assistant", content: first },
        { role: "user", content: `工具结果:\n${toolResult}\n\n请基于工具结果生成最终回复。` }
      ];
      finalText = (
        await this.llm.chatCompletions({
          model: this.config.LLM_MODEL,
          temperature: this.config.LLM_TEMPERATURE,
          messages: followup
        })
      ).trim();
    }

    this.memory.addMessage({
      conversationId,
      role: "user",
      content: cleanedText,
      timestampMs: Date.now(),
      messageId: evt.messageId
    });
    this.memory.addMessage({
      conversationId,
      role: "assistant",
      content: finalText,
      timestampMs: Date.now()
    });

    return { target, text: finalText };
  }

  private async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    ctx: { evt: ChatEvent; scopeKeys: string[] }
  ): Promise<string> {
    if (toolName === "memory_write") return "写入记忆已禁用：请使用 /记住 内容";
    try {
      const builtin = this.builtins.find((t) => t.name === toolName);
      if (builtin) {
        return builtin.run(args, { evt: ctx.evt, scopeKeys: ctx.scopeKeys, rag: this.rag, memory: this.memory });
      }

      const m = toolName.match(/^([^:]+)::(.+)$/);
      if (!m) return "工具名不合法";
      return this.mcp.callTool({ server: m[1], name: m[2], arguments: args });
    } catch (e: any) {
      return `工具调用失败：${String(e?.message ?? e)}`;
    }
  }
}

function parseOneLineJson(text: string): { tool: string; arguments?: Record<string, unknown> } | null {
  return parseToolCallFromText(text);
}

