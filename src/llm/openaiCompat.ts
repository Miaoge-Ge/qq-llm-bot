import { z } from "zod";

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };
export type LlmRichMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
};

export type LlmUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type LlmTextResult = {
  text: string;
  model?: string;
  usage?: LlmUsage;
};

const chatResponseSchema = z.object({
  model: z.string().optional(),
  choices: z.array(
    z.object({
      message: z.object({
        role: z.string(),
        content: z.string().nullable()
      })
    })
  ),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional()
    })
    .optional()
});

const embeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number())
    })
  )
});

export class OpenAiCompatClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined
  ) {}

  private v1Base(): string {
    const base = this.baseUrl.replace(/\/+$/, "");
    return base.endsWith("/v1") ? base : `${base}/v1`;
  }

  async chatCompletionsWithUsage(opts: {
    model: string;
    temperature: number;
    messages: LlmMessage[];
  }): Promise<LlmTextResult> {
    if (!this.apiKey) throw new Error("缺少 LLM_API_KEY");
    const url = `${this.v1Base()}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: opts.temperature,
        messages: opts.messages.map((m) => ({ role: m.role, content: m.content }))
      })
    });
    const json = await res.json().catch(() => undefined);
    if (!res.ok) throw new Error(`LLM 调用失败: ${res.status} ${JSON.stringify(json)}`);
    const parsed = chatResponseSchema.safeParse(json);
    if (!parsed.success) throw new Error("LLM 返回结构不符合预期");
    const usageRaw = parsed.data.usage;
    const usage =
      usageRaw && Number.isFinite(Number(usageRaw.total_tokens))
        ? {
            promptTokens: Number(usageRaw.prompt_tokens ?? 0),
            completionTokens: Number(usageRaw.completion_tokens ?? 0),
            totalTokens: Number(usageRaw.total_tokens ?? 0)
          }
        : undefined;
    return { text: parsed.data.choices[0]?.message.content ?? "", model: parsed.data.model, usage };
  }

  async chatCompletions(opts: {
    model: string;
    temperature: number;
    messages: LlmMessage[];
  }): Promise<string> {
    const r = await this.chatCompletionsWithUsage(opts);
    return r.text;
  }

  async chatCompletionsRichWithUsage(opts: {
    model: string;
    temperature: number;
    messages: LlmRichMessage[];
  }): Promise<LlmTextResult> {
    if (!this.apiKey) throw new Error("缺少 VISION_API_KEY");
    const url = `${this.v1Base()}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: opts.temperature,
        messages: opts.messages.map((m) => ({ role: m.role, content: m.content }))
      })
    });
    const json = await res.json().catch(() => undefined);
    if (!res.ok) throw new Error(`VISION 调用失败: ${res.status} ${JSON.stringify(json)}`);
    const parsed = chatResponseSchema.safeParse(json);
    if (!parsed.success) throw new Error("VISION 返回结构不符合预期");
    const usageRaw = parsed.data.usage;
    const usage =
      usageRaw && Number.isFinite(Number(usageRaw.total_tokens))
        ? {
            promptTokens: Number(usageRaw.prompt_tokens ?? 0),
            completionTokens: Number(usageRaw.completion_tokens ?? 0),
            totalTokens: Number(usageRaw.total_tokens ?? 0)
          }
        : undefined;
    return { text: parsed.data.choices[0]?.message.content ?? "", model: parsed.data.model, usage };
  }

  async chatCompletionsRich(opts: {
    model: string;
    temperature: number;
    messages: LlmRichMessage[];
  }): Promise<string> {
    const r = await this.chatCompletionsRichWithUsage(opts);
    return r.text;
  }

  async embed(opts: { model: string; input: string }): Promise<number[]> {
    if (!this.apiKey) throw new Error("缺少 LLM_API_KEY");
    const url = `${this.v1Base()}/embeddings`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: opts.model,
        input: opts.input
      })
    });
    const json = await res.json().catch(() => undefined);
    if (!res.ok) throw new Error(`Embedding 调用失败: ${res.status} ${JSON.stringify(json)}`);
    const parsed = embeddingResponseSchema.safeParse(json);
    if (!parsed.success) throw new Error("Embedding 返回结构不符合预期");
    return parsed.data.data[0]?.embedding ?? [];
  }
}
