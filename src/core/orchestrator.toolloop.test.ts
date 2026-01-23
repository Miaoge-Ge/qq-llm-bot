import test from "node:test";
import assert from "node:assert/strict";
import { Orchestrator } from "./orchestrator.js";

test("Orchestrator supports multi-step MCP tool loop", async () => {
  const calls: Array<{ server: string; name: string; arguments: Record<string, unknown> }> = [];

  const mcp = {
    listTools() {
      return [
        { server: "tools", name: "a", description: "tool a", inputSchema: undefined },
        { server: "tools", name: "b", description: "tool b", inputSchema: undefined }
      ];
    },
    async callTool(opts: { server: string; name: string; arguments: Record<string, unknown> }) {
      calls.push(opts);
      if (opts.name === "a") return "A_OK";
      if (opts.name === "b") return "B_OK";
      return "UNKNOWN";
    }
  } as any;

  let step = 0;
  const llm = {
    async chatCompletionsWithUsage() {
      step++;
      if (step === 1) return { text: "{\"tool\":\"tools::a\",\"arguments\":{\"x\":1}}", usage: undefined };
      if (step === 2) return { text: "{\"tool\":\"tools::b\",\"arguments\":{}}", usage: undefined };
      return { text: "好，两个都查完了：A_OK、B_OK。", usage: undefined };
    }
  } as any;

  const config = {
    NAPCAT_HTTP_URL: "http://127.0.0.1:3000",
    NAPCAT_WS_URL: "ws://127.0.0.1:3001",
    BOT_NAME: "阿棠",
    LLM_BASE_URL: "https://example.com/v1",
    LLM_API_KEY: "x",
    LLM_MODEL: "fake",
    LLM_TEMPERATURE: 0,
    SYSTEM_PROMPT: "",
    DATA_DIR: "data",
    GROUP_REPLY_MODE: "mention",
    GROUP_KEYWORDS: ["阿棠"],
    GROUP_FOLLOWUP_TURNS: 0,
    GROUP_FOLLOWUP_TTL_MS: 120000,
    GROUP_CONTEXT_TURNS: 4,
    GROUP_CONTEXT_TTL_MS: 300000,
    GROUP_CONTEXT_MAX_CHARS: 240,
    PRIVATE_CONTEXT_TURNS: 10,
    PRIVATE_CONTEXT_TTL_MS: 3600000,
    PRIVATE_CONTEXT_MAX_CHARS: 800,
    TOOL_TIMEOUT_MS: 15000
  } as any;

  const evt = {
    chatType: "private",
    userId: "u1",
    messageId: "m1",
    timestampMs: Date.now()
  } as any;

  const orchestrator = new Orchestrator(config, llm, mcp);
  const res = await orchestrator.handle(evt, { chatType: "private", userId: evt.userId }, "帮我查一下A，再查一下B");

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.server, "tools");
  assert.equal(calls[0]?.name, "a");
  assert.deepEqual(calls[0]?.arguments, { x: 1 });
  assert.equal(calls[1]?.server, "tools");
  assert.equal(calls[1]?.name, "b");
  assert.deepEqual(calls[1]?.arguments, {});
  assert.match(res.text, /A[_\s]*OK|AOK/);
  assert.match(res.text, /B[_\s]*OK|BOK/);
});
