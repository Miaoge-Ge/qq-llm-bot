export type CqAttachment = { type: string; data: Record<string, string> };

function decodeHtmlEntities(s: string): string {
  return s.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}

function cleanValue(v: string): string {
  let s = String(v ?? "").trim();
  if (!s) return "";
  s = decodeHtmlEntities(s);
  if ((s.startsWith("`") && s.endsWith("`")) || (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  try {
    if (/%[0-9A-Fa-f]{2}/.test(s)) s = decodeURIComponent(s);
  } catch {
  }
  return s.trim();
}

export function extractCqAttachments(text: string): CqAttachment[] {
  const s = String(text ?? "");
  if (!s) return [];
  const out: CqAttachment[] = [];
  const re = /\[CQ:(?<type>[a-zA-Z0-9_]+)(?<rest>(?:,[^\]]*)?)\]/g;
  for (const m of s.matchAll(re)) {
    const type = String((m as any).groups?.type ?? "").trim().toLowerCase();
    const rest = String((m as any).groups?.rest ?? "");
    const data: Record<string, string> = {};
    const body = rest.startsWith(",") ? rest.slice(1) : rest;
    if (body) {
      for (const part of body.split(",")) {
        const i = part.indexOf("=");
        if (i <= 0) continue;
        const k = part.slice(0, i).trim().toLowerCase();
        const v = cleanValue(part.slice(i + 1));
        if (!k || !v) continue;
        data[k] = v;
      }
    }
    if (type) out.push({ type, data });
  }
  return out;
}

export function extractCqFileUrls(text: string): string[] {
  const atts = extractCqAttachments(text);
  const urls: string[] = [];
  for (const a of atts) {
    if (a.type !== "video" && a.type !== "file" && a.type !== "record" && a.type !== "image") continue;
    const u = String(a.data.url ?? "").trim();
    if (!u) continue;
    if (!/^https?:\/\//i.test(u)) continue;
    urls.push(u);
  }
  return urls;
}
