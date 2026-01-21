import type { ChatEvent, SendMessage } from "../types.js";

function formatTarget(target: SendMessage["target"]): string {
  if (target.chatType === "private") return `私聊 u=${target.userId}`;
  return `群聊 g=${target.groupId}`;
}

function brief(text: string, max = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function printInbound(evt: ChatEvent, displayText: string): void {
  if (evt.chatType === "private") {
    console.log(`RX 私聊 u=${evt.userId} : ${brief(displayText)}`);
    return;
  }
  console.log(`RX 群聊 g=${evt.groupId} u=${evt.userId} : ${brief(displayText)}`);
}

export function printOutbound(target: SendMessage["target"], text: string): void {
  console.log(`TX ${formatTarget(target)} : ${brief(text)}`);
}

export function printError(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`ERR ${context} : ${msg}`);
}
