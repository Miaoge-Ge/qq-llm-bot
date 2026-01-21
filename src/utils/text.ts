import type { MessageSegment } from "../types.js";

export function segmentsToText(segments: MessageSegment[]): string {
  return segments
    .map((s) => {
      if (s.type === "text") return s.data.text;
      if (s.type === "at") return `@${s.data.qq}`;
      return "";
    })
    .join("")
    .trim();
}

export function normalizeSegments(message: unknown): MessageSegment[] {
  if (Array.isArray(message)) return message as MessageSegment[];
  if (typeof message === "string") return [{ type: "text", data: { text: message } }];
  return [{ type: "text", data: { text: String(message ?? "") } }];
}

export function stripAtMentions(text: string): string {
  return text.replace(/@\d+/g, "").trim();
}

