import WebSocket from "ws";
import { z } from "zod";
import { logger } from "../../logger.js";
import type { AppConfig } from "../../config.js";
import type { ChatEvent, OneBotMessageEvent, SendMessage } from "../../types.js";
import { normalizeSegments, segmentsToText } from "../../utils/text.js";

const oneBotIdSchema = z.union([z.number(), z.string()]);

const oneBotMessageEventSchema = z.object({
  post_type: z.literal("message"),
  time: z.number(),
  self_id: oneBotIdSchema,
  message_type: z.union([z.literal("private"), z.literal("group")]),
  message_id: oneBotIdSchema,
  user_id: oneBotIdSchema,
  group_id: oneBotIdSchema.optional(),
  message: z.any(),
  raw_message: z.string().optional()
});

export class NapCatClient {
  private ws?: WebSocket;
  private readonly httpUrl: string;
  private readonly wsUrl: string;
  private readonly httpToken?: string;
  private readonly wsToken?: string;
  private selfId?: string;

  constructor(private readonly config: AppConfig) {
    this.httpUrl = config.NAPCAT_HTTP_URL.replace(/\/+$/, "");
    this.wsUrl = config.NAPCAT_WS_URL.replace(/\/+$/, "");
    this.httpToken = config.NAPCAT_HTTP_TOKEN;
    this.wsToken = config.NAPCAT_WS_TOKEN;
    this.selfId = config.BOT_QQ_ID;
  }

  get botId(): string | undefined {
    return this.selfId;
  }

  async getMessageContext(messageId: string): Promise<{ text: string | null; segments: ReturnType<typeof normalizeSegments> } | null> {
    try {
      const res: any = await this.callApi("get_msg", { message_id: messageId });
      const data = res?.data ?? res;
      const segments = normalizeSegments(data?.message);
      const text = segmentsToText(segments) || String(data?.raw_message ?? "").trim();
      return { text: text || null, segments };
    } catch {
      return null;
    }
  }

  async getImageDataUrls(segments: { type: string; data: Record<string, unknown> }[]): Promise<string[]> {
    const out: string[] = [];
    for (const s of segments) {
      if (s.type !== "image") continue;
      const data = s.data ?? {};
      const url = typeof (data as any).url === "string" ? String((data as any).url) : undefined;
      const file = typeof (data as any).file === "string" ? String((data as any).file) : undefined;

      const fetched = await this.fetchImageToDataUrl(url ?? file);
      if (fetched) out.push(fetched);
      if (out.length >= 3) break;
    }
    return out;
  }

  private async fetchImageToDataUrl(urlOrFile?: string): Promise<string | null> {
    if (!urlOrFile) return null;
    let finalUrl = urlOrFile;
    if (!/^https?:\/\//i.test(finalUrl) && !/^data:/i.test(finalUrl)) {
      try {
        const res: any = await this.callApi("get_image", { file: finalUrl });
        finalUrl = String(res?.data?.url ?? res?.url ?? "");
      } catch {
        return null;
      }
    }
    if (!finalUrl || /^data:/i.test(finalUrl)) return finalUrl || null;

    try {
      const headers: Record<string, string> = {};
      if (this.httpToken) headers["Authorization"] = `Bearer ${this.httpToken}`;
      const res = await fetch(finalUrl, { method: "GET", headers });
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") ?? "";
      const mime = ct.includes("image/") ? ct.split(";")[0] : guessImageMime(finalUrl);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > 4_000_000) return null;
      const b64 = buf.toString("base64");
      return `data:${mime};base64,${b64}`;
    } catch {
      return null;
    }
  }

  connect(onEvent: (evt: ChatEvent) => Promise<void>): void {
    const headers: Record<string, string> = {};
    if (this.wsToken) headers["Authorization"] = `Bearer ${this.wsToken}`;

    this.ws = new WebSocket(this.wsUrl, { headers });

    this.ws.on("open", () => {
      logger.debug({ wsUrl: this.wsUrl }, "NapCat WebSocket connected");
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
      logger.debug({ code, reason: String(reason) }, "NapCat WebSocket closed");
      setTimeout(() => this.connect(onEvent), 1500);
    });

    this.ws.on("error", (err: Error) => {
      logger.error({ err }, "NapCat WebSocket error");
    });

    this.ws.on("message", async (data: WebSocket.RawData) => {
      const rawText = typeof data === "string" ? data : data.toString("utf8");
      let json: unknown;
      try {
        json = JSON.parse(rawText);
      } catch {
        return;
      }

      const parsed = oneBotMessageEventSchema.safeParse(json);
      if (!parsed.success) return;

      const evt = this.toChatEvent(parsed.data as OneBotMessageEvent);
      if (!this.selfId) this.selfId = String(parsed.data.self_id);
      try {
        await onEvent(evt);
      } catch (err) {
        logger.error({ err, messageId: evt.messageId }, "Handle event failed");
      }
    });
  }

  async send(msg: SendMessage): Promise<void> {
    if (msg.target.chatType === "private") {
      await this.callApi("send_private_msg", {
        user_id: msg.target.userId,
        message: msg.text
      });
      return;
    }

    await this.callApi("send_group_msg", {
      group_id: msg.target.groupId,
      message: msg.text
    });
  }

  private toChatEvent(e: OneBotMessageEvent): ChatEvent {
    const segments = normalizeSegments(e.message);
    const text = segmentsToText(segments) || e.raw_message || "";
    const replySeg = segments.find((s) => s.type === "reply");
    const replyToMessageId = replySeg ? String(((replySeg as any).data?.id ?? (replySeg as any).data?.message_id ?? "") || "") : undefined;

    return {
      platform: "napcatqq",
      chatType: e.message_type,
      messageId: String(e.message_id),
      userId: String(e.user_id),
      groupId: e.group_id ? String(e.group_id) : undefined,
      replyToMessageId: replyToMessageId || undefined,
      segments,
      text,
      timestampMs: e.time * 1000,
      raw: e
    };
  }

  private async callApi(action: string, params: Record<string, unknown>): Promise<unknown> {
    const url = `${this.httpUrl}/${action}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.httpToken) headers["Authorization"] = `Bearer ${this.httpToken}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(params)
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`NapCat API ${action} failed: ${res.status} ${text}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

function guessImageMime(url: string): string {
  const u = url.toLowerCase();
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".webp")) return "image/webp";
  if (u.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

