import "dotenv/config";
import { loadConfig } from "../config.js";

type CheckResult = { ok: boolean; detail: string };

async function checkHttp(httpUrl: string, token?: string): Promise<CheckResult> {
  const base = httpUrl.replace(/\/+$/, "");
  const actionCandidates = ["get_status", "get_version_info"];
  for (const action of actionCandidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 800);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${base}/${action}`, {
        method: "POST",
        headers,
        body: "{}",
        signal: controller.signal
      });
      clearTimeout(timer);
      const text = await res.text();
      if (res.ok) return { ok: true, detail: `${action}: ${text.slice(0, 180)}` };
      return { ok: false, detail: `${action}: ${res.status} ${text.slice(0, 180)}` };
    } catch (e: any) {
      return { ok: false, detail: `${action}: ${String(e?.message ?? e)}` };
    }
  }
  return { ok: false, detail: "no_action_tested" };
}

async function checkWs(wsUrl: string, token?: string): Promise<CheckResult> {
  try {
    const { default: WebSocket } = await import("ws");
    return await new Promise((resolve) => {
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const ws = new WebSocket(wsUrl, { headers });
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        resolve({ ok: false, detail: "timeout" });
      }, 800);

      ws.on("open", () => {
        clearTimeout(timer);
        ws.close();
        resolve({ ok: true, detail: "connected" });
      });
      ws.on("error", (err: any) => {
        clearTimeout(timer);
        resolve({ ok: false, detail: String(err?.message ?? err) });
      });
    });
  } catch (e: any) {
    return { ok: false, detail: String(e?.message ?? e) };
  }
}

const cfg = loadConfig();

console.log("NapCat 配置:");
console.log("  NAPCAT_HTTP_URL =", cfg.NAPCAT_HTTP_URL);
console.log("  NAPCAT_WS_URL   =", cfg.NAPCAT_WS_URL);
console.log("");

const http = await checkHttp(cfg.NAPCAT_HTTP_URL, cfg.NAPCAT_HTTP_TOKEN);
const ws = await checkWs(cfg.NAPCAT_WS_URL, cfg.NAPCAT_WS_TOKEN);

console.log("连通性检测:");
console.log("  HTTP:", http.ok ? "OK" : "FAIL", "-", http.detail);
console.log("  WS  :", ws.ok ? "OK" : "FAIL", "-", ws.detail);
console.log("");

if (!ws.ok) {
  console.log("WS 连接失败通常表示 NapCatQQ 未启动或 WS 端口/地址不对。");
  console.log("如果你已开启 OneBot WS 上报，请把 NAPCAT_WS_URL 改成实际地址后重试。");
  console.log("");
}

if (!http.ok && http.detail.includes("token verify failed")) {
  console.log("HTTP 显示 token verify failed，说明 NapCatQQ 的 HTTP Server 开了 token。");
  console.log("请在 .env 里设置 NAPCAT_HTTP_TOKEN，并确保与 NapCatQQ 配置一致。");
  console.log("");
}
