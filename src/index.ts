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
import { extractCqAttachments, extractCqFileUrls } from "./utils/cq.js";
import { stripAtMentions } from "./utils/text.js";

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
const groupMuteUntilMs = new Map<string, number>();
const recentMessageIds = new Map<string, number>();

function tryParseJson(text: string): any | null {
  const s = String(text ?? "").trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizePowerText(text: string): string {
  const t0 = stripAtMentions(String(text ?? "")).trim();
  return t0.replace(/\s+/g, "").trim();
}

function parsePowerCommand(text: string): { kind: "off"; hours: number } | { kind: "on" } | null {
  const t = normalizePowerText(text);
  if (!t) return null;
  if (t === "开机" || t === "开机一下") return { kind: "on" };
  const m1 = t.match(/^关机(?:(\d+(?:\.\d+)?)小时?)?$/);
  if (m1) {
    const h = m1[1] ? Number(m1[1]) : 1;
    return { kind: "off", hours: Number.isFinite(h) && h > 0 ? h : 1 };
  }
  const m2 = t.match(/^关机(\d+(?:\.\d+)?)h$/i);
  if (m2) {
    const h = Number(m2[1]);
    return { kind: "off", hours: Number.isFinite(h) && h > 0 ? h : 1 };
  }
  return null;
}

napcat.connect(async (evt) => {
  try {
    const nowMs = Date.now();
    const id = String(evt.messageId ?? "");
    if (id) {
      const last = recentMessageIds.get(id) ?? 0;
      if (last && nowMs - last < 30_000) return;
      recentMessageIds.set(id, nowMs);
      if (recentMessageIds.size > 2000) {
        for (const [k, v] of recentMessageIds) {
          if (nowMs - v > 120_000) recentMessageIds.delete(k);
        }
        if (recentMessageIds.size > 2000) {
          const firstKey = recentMessageIds.keys().next().value as string | undefined;
          if (firstKey) recentMessageIds.delete(firstKey);
        }
      }
    }

    const quickDisplayText = evt.text.trim() || "[non-text]";
    printInbound(evt, quickDisplayText);

    if (evt.chatType === "group" && evt.groupId) {
      const cmd0 = parsePowerCommand(evt.text);
      if (cmd0) {
        try {
          if (cmd0.kind === "on") {
            const raw = await mcp.callTool({
              server: "tools",
              name: "bot_power_on",
              arguments: { chat_type: "group", group_id: evt.groupId, user_id: evt.userId }
            });
            const obj = tryParseJson(raw);
            if (obj && typeof obj === "object") groupMuteUntilMs.delete(evt.groupId);
            const ok = typeof raw === "string" && !raw.startsWith("错误：");
            if (ok) {
              await napcat.send({ target: { chatType: "group", groupId: evt.groupId }, text: "已开机，已恢复回复。" });
            } else {
              await napcat.send({ target: { chatType: "group", groupId: evt.groupId }, text: String(raw || "开机失败") });
            }
          } else {
            const raw = await mcp.callTool({
              server: "tools",
              name: "bot_power_off",
              arguments: { chat_type: "group", group_id: evt.groupId, user_id: evt.userId, hours: cmd0.hours }
            });
            const obj = tryParseJson(raw);
            const until = obj && typeof obj.until_ms === "number" ? obj.until_ms : 0;
            if (until > Date.now()) groupMuteUntilMs.set(evt.groupId, until);
            const ok = typeof raw === "string" && !raw.startsWith("错误：");
            if (ok) {
              await napcat.send({ target: { chatType: "group", groupId: evt.groupId }, text: `已关机，${cmd0.hours}小时内不再回复。` });
            } else {
              await napcat.send({ target: { chatType: "group", groupId: evt.groupId }, text: String(raw || "关机失败") });
            }
          }
        } catch {
        }
        return;
      }
    }

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

    if (evt.chatType === "group" && evt.groupId) {
      const until0 = groupMuteUntilMs.get(evt.groupId) ?? 0;
      if (until0 > Date.now()) return;
      if (until0 > 0) groupMuteUntilMs.delete(evt.groupId);
      try {
        const raw = await mcp.callTool({
          server: "tools",
          name: "bot_power_status",
          arguments: { chat_type: "group", group_id: evt.groupId }
        });
        const obj = tryParseJson(raw);
        const muted = !!(obj && typeof obj === "object" && obj.muted === true);
        const until = obj && typeof obj.until_ms === "number" ? obj.until_ms : 0;
        if (muted && until > Date.now()) {
          groupMuteUntilMs.set(evt.groupId, until);
          return;
        }
      } catch {
      }
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
    const includeImageUrls = imageDataUrls.length === 0;
    const inboundFileUrls = extractFileUrlsFromText(evt.text, includeImageUrls);
    const repliedFileUrls = repliedText ? extractFileUrlsFromText(repliedText, includeImageUrls) : [];
    const fileInputs = dedupeStrings([...imageDataUrls, ...inboundFileUrls, ...repliedFileUrls]).slice(0, 10);

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

function extractFileUrlsFromText(text: string, includeImageUrls: boolean): string[] {
  const urls: string[] = [];
  const atts = extractCqAttachments(text);
  if (!atts.length) return extractCqFileUrls(text);
  for (const a of atts) {
    const u = String(a.data.url ?? "").trim();
    if (!u || !/^https?:\/\//i.test(u)) continue;
    if (!includeImageUrls && a.type === "image") continue;
    urls.push(u);
  }
  return urls;
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of items) {
    const s = String(x ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

logger.info(
  {
    napcatWsUrl: config.NAPCAT_WS_URL,
    napcatHttpUrl: config.NAPCAT_HTTP_URL,
    groupReplyMode: config.GROUP_REPLY_MODE
  },
  "Bot started"
);
