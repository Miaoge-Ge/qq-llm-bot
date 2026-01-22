import type { AppConfig } from "../../config.js";
import type { SendMessage } from "../../types.js";

export class NapCatHttpSender {
  private readonly httpUrl: string;
  private readonly httpToken?: string;

  constructor(private readonly config: AppConfig) {
    this.httpUrl = config.NAPCAT_HTTP_URL.replace(/\/+$/, "");
    this.httpToken = config.NAPCAT_HTTP_TOKEN;
  }

  async send(msg: SendMessage): Promise<void> {
    if (msg.target.chatType === "private") {
      await this.callApi("send_private_msg", { user_id: msg.target.userId, message: msg.text });
      return;
    }
    await this.callApi("send_group_msg", { group_id: msg.target.groupId, message: msg.text });
  }

  private async callApi(action: string, params: Record<string, unknown>): Promise<unknown> {
    const url = `${this.httpUrl}/${action}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.httpToken) headers["Authorization"] = `Bearer ${this.httpToken}`;

    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(params) });
    const text = await res.text();
    if (!res.ok) throw new Error(`NapCat API ${action} failed: ${res.status} ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

