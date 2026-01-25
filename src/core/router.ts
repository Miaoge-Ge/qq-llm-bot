import type { AppConfig } from "../config.js";
import type { ChatEvent, SendMessage } from "../types.js";
import { stripSpecificAtMentions } from "../utils/text.js";
import { parseToolCallFromText } from "../utils/toolCall.js";
import type { GroupConversationWindow } from "./sessionWindow.js";

export type RouteDecision =
  | { kind: "ignore"; reason: string }
  | { kind: "handle"; target: SendMessage["target"]; cleanedText: string };

export function routeEvent(
  config: AppConfig,
  botId: string | undefined,
  evt: ChatEvent,
  sessions?: GroupConversationWindow
): RouteDecision {
  if (botId && evt.userId === botId) return { kind: "ignore", reason: "self_message" };

  if (evt.chatType === "private") {
    return {
      kind: "handle",
      target: { chatType: "private", userId: evt.userId },
      cleanedText: evt.text.trim()
    };
  }

  const mode = config.GROUP_REPLY_MODE;
  const text = evt.text.trim();
  const hasAtAll =
    evt.segments.some((s) => s.type === "at" && String((s as any).data.qq) === "all") ||
    /@all|@全体成员|@全员|@所有人/.test(text);
  if (hasAtAll) return { kind: "ignore", reason: "at_all" };
  const isDirectToolCall = !!parseToolCallFromText(text);
  const keywords = (config.GROUP_KEYWORDS ?? []).filter(Boolean);
  const nameKeyword = (config.BOT_NAME ?? "").trim();
  const allKeywords = [nameKeyword, ...keywords].filter(Boolean);
  const matchedKeyword = allKeywords.find((k) => text.includes(k));

  if (mode === "all") {
    return { kind: "handle", target: { chatType: "group", groupId: evt.groupId! }, cleanedText: text };
  }

  if (mode === "keyword") {
    if (!isDirectToolCall && !matchedKeyword) return { kind: "ignore", reason: "no_keyword" };
    return {
      kind: "handle",
      target: { chatType: "group", groupId: evt.groupId! },
      cleanedText: (matchedKeyword ? text.replace(matchedKeyword, "") : text).trim()
    };
  }

  if (isDirectToolCall) {
    return { kind: "handle", target: { chatType: "group", groupId: evt.groupId! }, cleanedText: text };
  }

  const isMentioned =
    evt.segments.some((s) => s.type === "at" && String((s as any).data.qq) === botId) ||
    (botId ? text.includes(`@${botId}`) : false);

  if (!isMentioned) {
    if (!matchedKeyword) {
      return { kind: "ignore", reason: "not_mentioned" };
    }
    return {
      kind: "handle",
      target: { chatType: "group", groupId: evt.groupId! },
      cleanedText: (matchedKeyword ? text.replace(matchedKeyword, "") : text).trim()
    };
  }

  return {
    kind: "handle",
    target: { chatType: "group", groupId: evt.groupId! },
    cleanedText: stripSpecificAtMentions(text, [botId ?? "", "all"])
  };
}
