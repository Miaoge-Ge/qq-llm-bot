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

export function stripSpecificAtMentions(text: string, ids: string[]): string {
  let out = String(text ?? "");
  for (const id of ids.map((x) => String(x).trim()).filter(Boolean)) {
    out = out.replaceAll(`@${id}`, "");
  }
  return out.replace(/\s+/g, " ").trim();
}

export function sanitizeChatText(text: string): string {
  let s = String(text ?? "");
  if (!s) return "";

  s = s.replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ""));
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)");
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  s = s.replace(/^\s{0,3}>\s?/gm, "");
  s = s.replace(/^\s{0,3}(-{3,}|_{3,}|\*{3,})\s*$/gm, "");
  s = s.replace(/^\s{0,3}[-*+]\s+/gm, "");
  s = s.replace(/^\s{0,3}\d+\.\s+/gm, "");
  s = s.replace(/`([^`]*)`/g, "$1");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/_([^_]+)_/g, "$1");
  s = s.replace(/^\s*[-–—]\s*/gm, "");

  s = s.replace(/\r\n/g, "\n");
  s = s.replace(/\n{2,}/g, "\n");
  return s.trim();
}

export function limitChatText(text: string, opts: { maxChars: number; maxLines: number; suffix?: string }): string {
  const raw = String(text ?? "").trim();
  if (!raw) return "";

  let s = raw;
  const lines = s.split("\n").filter((x) => x.trim() !== "");
  if (opts.maxLines > 0 && lines.length > opts.maxLines) {
    s = lines.slice(0, opts.maxLines).join("\n").trim();
  }
  if (opts.maxChars > 0 && s.length > opts.maxChars) {
    s = s.slice(0, opts.maxChars).trimEnd();
  }

  const wasTruncated = s.length < raw.length || (opts.maxLines > 0 && lines.length > opts.maxLines);
  if (wasTruncated) {
    s = trimToNaturalEnding(s, Math.min(Math.max(40, Math.floor(opts.maxChars * 0.5)), opts.maxChars));
  }

  if (wasTruncated && opts.suffix) {
    const suffix = opts.suffix.trim();
    if (suffix) {
      const space = s.endsWith("\n") || s.endsWith("。") || s.endsWith("！") || s.endsWith("？") ? "" : " ";
      const targetMax = Math.max(0, opts.maxChars - suffix.length - space.length);
      if (opts.maxChars > 0 && s.length > targetMax) s = s.slice(0, targetMax).trimEnd();
      s = `${s}${space}${suffix}`.trim();
    }
  }
  return s;
}

function trimToNaturalEnding(text: string, minKeepChars: number): string {
  const t = String(text ?? "").trimEnd();
  if (!t) return "";
  if (/[。！？!?…；;]\s*$/.test(t)) return t;

  const lookback = 80;
  const start = Math.max(0, t.length - lookback);
  const tail = t.slice(start);

  const candidates = ["。", "！", "？", "!", "?", "…", "；", ";", "\n", " "];
  let bestIndex = -1;
  for (const c of candidates) {
    bestIndex = Math.max(bestIndex, tail.lastIndexOf(c));
  }
  if (bestIndex <= 0) return t;

  const cutPos = start + bestIndex + 1;
  const cut = t.slice(0, cutPos).trimEnd();
  if (cut.length < minKeepChars) return t;
  return cut;
}
