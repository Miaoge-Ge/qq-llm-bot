import test from "node:test";
import assert from "node:assert/strict";
import { ToolManager } from "./toolManager.js";

function fakeEvt(overrides?: Partial<any>) {
  return {
    platform: "napcatqq",
    chatType: "private",
    messageId: "m1",
    userId: "u1",
    groupId: undefined,
    replyToMessageId: undefined,
    segments: [],
    text: "",
    timestampMs: 1710000000000,
    raw: {},
    ...(overrides ?? {})
  };
}

test("ToolManager injects reminder context into MCP args", async () => {
  let called: any = null;
  const mcp = {
    listTools() {
      return [
        {
          server: "tools",
          name: "reminder_create",
          description: "x",
          inputSchema: {
            type: "object",
            properties: {
              chat_type: { type: "string" },
              user_id: { type: "string" },
              group_id: { type: "string" },
              message_id: { type: "string" },
              now_ms: { type: "integer" },
              request: { type: "string" }
            },
            required: ["chat_type", "user_id"],
            additionalProperties: true
          }
        }
      ];
    },
    async callTool(opts: any) {
      called = opts;
      return "ok";
    }
  };

  const mgr = new ToolManager({ TOOL_TIMEOUT_MS: 15000 } as any, mcp as any);
  const out = await mgr.execute("tools::reminder_create", { request: "半个小时之后提醒我去剪头发" }, { evt: fakeEvt() as any });
  assert.equal(out, "ok");
  assert.equal(called?.arguments?.chat_type, "private");
  assert.equal(called?.arguments?.user_id, "u1");
  assert.equal(called?.arguments?.message_id, "m1");
  assert.equal(called?.arguments?.now_ms, 1710000000000);
});

test("ToolManager injects group_id for group reminders", async () => {
  let called: any = null;
  const mcp = {
    listTools() {
      return [
        {
          server: "tools",
          name: "reminder_list",
          description: "x",
          inputSchema: {
            type: "object",
            properties: {
              chat_type: { type: "string" },
              user_id: { type: "string" },
              group_id: { type: "string" }
            },
            required: ["chat_type", "user_id"],
            additionalProperties: true
          }
        }
      ];
    },
    async callTool(opts: any) {
      called = opts;
      return "ok";
    }
  };

  const mgr = new ToolManager({ TOOL_TIMEOUT_MS: 15000 } as any, mcp as any);
  const out = await mgr.execute("tools::reminder_list", {}, { evt: fakeEvt({ chatType: "group", groupId: "g1" }) as any });
  assert.equal(out, "ok");
  assert.equal(called?.arguments?.chat_type, "group");
  assert.equal(called?.arguments?.user_id, "u1");
  assert.equal(called?.arguments?.group_id, "g1");
});

