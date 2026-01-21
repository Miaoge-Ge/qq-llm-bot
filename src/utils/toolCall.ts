export type ToolCall = { tool: string; arguments?: Record<string, unknown> };

export function parseToolCallFromText(text: string): ToolCall | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const fence = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const t = (fence ? fence[1] : raw).trim();

  const parsedDirect = safeParseToolCallJson(t);
  if (parsedDirect) return parsedDirect;

  const embedded = extractFirstJsonObject(t);
  if (!embedded) return null;
  return safeParseToolCallJson(embedded);
}

function safeParseToolCallJson(candidate: string): ToolCall | null {
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;
  try {
    const obj = JSON.parse(candidate);
    if (!obj || typeof obj.tool !== "string") return null;
    if (obj.arguments && typeof obj.arguments !== "object") return null;
    return obj;
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text: string): string | null {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === "\\") {
          escape = true;
        } else if (ch === "\"") {
          inString = false;
        }
        continue;
      }
      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1).trim();
        if (candidate.includes("\"tool\"")) return candidate;
        break;
      }
    }
  }
  return null;
}

