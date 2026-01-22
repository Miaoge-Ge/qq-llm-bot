import type { AppConfig } from "../../config.js";
import type { OpenAiCompatClient } from "../../llm/openaiCompat.js";
import { limitChatText, sanitizeChatText } from "../../utils/text.js";

function stripBotPrefix(text: string, botName: string | undefined): string {
  const name = String(botName ?? "").trim();
  if (!name) return text;
  const re = new RegExp(`^\\s*(?:@?${escapeRegExp(name)})\\s*[:：]\\s*`, "i");
  return String(text ?? "").replace(re, "").trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeModelChatText(text: string): string {
  return String(text ?? "")
    .replace(/\[CQ:at,qq=\d+\]/g, " ")
    .replace(/@\d+/g, " ")
    .replace(/@/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksBroken(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return true;
  if (t.length < 4) return true;
  if (/[并而且但是然后以及]$/.test(t)) return true;
  return false;
}

export async function rewriteAck(
  llm: OpenAiCompatClient,
  config: AppConfig,
  input: { dueAtText: string; mentionPrefix?: string; reminderText: string }
): Promise<string> {
  const sys =
    `你是 QQ 群聊里的助手，昵称是${config.BOT_NAME}。把“设置提醒”的确认回复说得自然一点。\n` +
    "要求：\n- 只输出普通文本，不要 Markdown\n- 不要输出 JSON\n- 不要出现多余空行\n- 1-2 行\n- 语气自然\n";
  const user = `提醒时间：${input.dueAtText}\n提醒内容：${input.reminderText}\n是否需要@某人：${input.mentionPrefix ? "是" : "否"}`;
  try {
    const out = (await llm.chatCompletions({ model: config.LLM_MODEL, temperature: 0.3, messages: [{ role: "system", content: sys }, { role: "user", content: user }] })).trim();
    const cleaned = sanitizeModelChatText(stripBotPrefix(sanitizeChatText(out), config.BOT_NAME));
    const limited = limitChatText(cleaned, { maxChars: 260, maxLines: 3 });
    if (looksBroken(limited)) throw new Error("bad_text");
    const prefix = input.mentionPrefix ? `${input.mentionPrefix} ` : "";
    return `${prefix}${limited}`.trim();
  } catch {
    const prefix = input.mentionPrefix ? `${input.mentionPrefix} ` : "";
    return `${prefix}好，我会在 ${input.dueAtText} 提醒你：${input.reminderText}`.trim();
  }
}

export async function rewriteFire(
  llm: OpenAiCompatClient,
  config: AppConfig,
  input: { mentionPrefix?: string; reminderText: string }
): Promise<string> {
  const sys =
    `你是 QQ 群聊里的助手，昵称是${config.BOT_NAME}。把“提醒触发”的消息说得自然一点。\n` +
    "要求：\n- 只输出普通文本，不要 Markdown\n- 不要输出 JSON\n- 不要出现多余空行\n- 1-2 行\n- 不要解释你怎么得到的\n";
  const user = `提醒内容：${input.reminderText}\n是否需要@某人：${input.mentionPrefix ? "是" : "否"}`;
  try {
    const out = (await llm.chatCompletions({ model: config.LLM_MODEL, temperature: 0.3, messages: [{ role: "system", content: sys }, { role: "user", content: user }] })).trim();
    const cleaned = sanitizeModelChatText(stripBotPrefix(sanitizeChatText(out), config.BOT_NAME));
    const limited = limitChatText(cleaned, { maxChars: 220, maxLines: 2 });
    if (looksBroken(limited)) throw new Error("bad_text");
    const prefix = input.mentionPrefix ? `${input.mentionPrefix} ` : "";
    return `${prefix}${limited}`.trim();
  } catch {
    const prefix = input.mentionPrefix ? `${input.mentionPrefix} ` : "";
    return `${prefix}提醒：${input.reminderText}`.trim();
  }
}
