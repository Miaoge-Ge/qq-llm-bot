import "dotenv/config";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { NapCatClient } from "./adapters/napcatqq/NapCatClient.js";
import { routeEvent } from "./core/router.js";
import { OpenAiCompatClient } from "./llm/openaiCompat.js";
import { McpRegistry } from "./mcp/registry.js";
import { Orchestrator } from "./core/orchestrator.js";
import { printError, printInbound, printOutbound } from "./observability/console.js";
import { NoteStore } from "./core/noteStore.js";
import { handleCommands } from "./core/commands.js";
import { StatsStore } from "./stats/store.js";
import { GroupConversationWindow } from "./core/sessionWindow.js";
import { ConversationMemory } from "./core/conversationMemory.js";
import { extractCqFileUrls } from "./utils/cq.js";

const config = loadConfig();

const llm = new OpenAiCompatClient(config.LLM_BASE_URL, config.LLM_API_KEY);
const mcp = new McpRegistry();
await mcp.connectAll();

const stats = new StatsStore(config);
const memory = new ConversationMemory(config);
const orchestrator = new Orchestrator(config, llm, mcp, stats, memory);
const napcat = new NapCatClient(config);
const notes = new NoteStore(config);
const sessions = new GroupConversationWindow(config);

napcat.connect(async (evt) => {
  try {
    const quickDisplayText = evt.text.trim() || "[non-text]";
    printInbound(evt, quickDisplayText);

    const decision = routeEvent(config, napcat.botId, evt, sessions);
    if (decision.kind === "ignore") {
      logger.debug(
        {
          reason: decision.reason,
          chatType: evt.chatType,
          userId: evt.userId,
          groupId: evt.groupId,
          text: evt.text.slice(0, 200)
        },
        "route ignored"
      );
      return;
    }

    const cmd = await handleCommands({
      evt,
      target: decision.target,
      text: decision.cleanedText,
      mcp,
      notes,
      stats,
      napcat
    });
    if (cmd.handled) {
      const rewritten = await orchestrator.rewrite(evt, cmd.replyText);
      const out = { target: decision.target, text: rewritten || cmd.replyText };
      await napcat.send(out);
      memory.addUser(evt, decision.cleanedText, evt.timestampMs || Date.now());
      memory.addAssistant(evt, out.text, Date.now());
      printOutbound(out.target, out.text);
      return;
    }

    let repliedText: string | null = null;
    let repliedImageDataUrls: string[] = [];
    let repliedForwardText: string | null = null;
    if (evt.replyToMessageId) {
      const ctx = await napcat.getMessageContext(evt.replyToMessageId);
      repliedText = ctx?.text ?? null;
      if (ctx?.segments?.length) {
        repliedImageDataUrls = await napcat.getImageDataUrls(ctx.segments);
        repliedForwardText = await napcat.getForwardTextFromSegments(ctx.segments);
      }
    }

    const inboundForwardText = await napcat.getForwardTextFromSegments(evt.segments);
    const inboundImageDataUrls = await napcat.getImageDataUrls(evt.segments);
    const imageDataUrls = [...inboundImageDataUrls, ...repliedImageDataUrls].filter(Boolean).slice(0, 3);
    const inboundFileUrls = extractCqFileUrls(evt.text);
    const repliedFileUrls = repliedText ? extractCqFileUrls(repliedText) : [];
    const fileInputs = [...imageDataUrls, ...inboundFileUrls, ...repliedFileUrls].filter(Boolean).slice(0, 10);

    let effectiveText = decision.cleanedText;
    if (inboundForwardText) {
      effectiveText = effectiveText
        ? `转发聊天记录：\n${inboundForwardText}\n\n用户补充：\n${effectiveText}`
        : `转发聊天记录：\n${inboundForwardText}`;
    }
    if (repliedText) {
      effectiveText = effectiveText
        ? `用户回复了这条消息：\n${repliedText}\n\n用户补充：\n${effectiveText}`
        : `用户回复了这条消息：\n${repliedText}`;
    }
    if (repliedForwardText) {
      effectiveText = effectiveText
        ? `被回复消息包含转发聊天记录：\n${repliedForwardText}\n\n用户补充：\n${effectiveText}`
        : `被回复消息包含转发聊天记录：\n${repliedForwardText}`;
    }

    const reply = await orchestrator.handle(evt, decision.target, effectiveText, { imageDataUrls, fileInputs });
    await napcat.send(reply);
    memory.addUser(evt, effectiveText, evt.timestampMs || Date.now());
    memory.addAssistant(evt, reply.text, Date.now());
    printOutbound(reply.target, reply.text);
  } catch (err) {
    printError("handle/send", err);
    logger.error({ err }, "handle/send failed");
  }
});

logger.info(
  {
    napcatWsUrl: config.NAPCAT_WS_URL,
    napcatHttpUrl: config.NAPCAT_HTTP_URL,
    groupReplyMode: config.GROUP_REPLY_MODE
  },
  "Bot started"
);
