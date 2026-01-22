import type { AppConfig } from "../../config.js";
import type { OpenAiCompatClient } from "../../llm/openaiCompat.js";
import { NapCatHttpSender } from "./napcatHttp.js";
import { ReminderStore } from "./store.js";

function formatMention(mentionUserId: string | undefined): string | undefined {
  const id = String(mentionUserId ?? "").trim();
  if (!id) return undefined;
  return `[CQ:at,qq=${id}]`;
}

export class ReminderSchedulerService {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: AppConfig,
    private readonly llm: OpenAiCompatClient,
    private readonly store: ReminderStore,
    private readonly sender: NapCatHttpSender
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    const due = this.store.claimDue(now, 10);

    if (!due.length) return;

    for (const rem of due) {
      if (!this.store.tryAcquireSendLock(rem.id, now)) continue;
      try {
        const prefix = formatMention(rem.mentionUserId);
        const text = `${prefix ? `${prefix} ` : ""}提醒：${rem.text}`.trim();
        await this.sender.send({ target: rem.target, text });
        this.store.markSent(rem.id);
      } catch (e: any) {
        this.store.markFailed(rem.id, String(e?.message ?? e));
      } finally {
        this.store.releaseSendLock(rem.id);
      }
    }
  }
}
