import test from "node:test";
import assert from "node:assert/strict";
import { parseReminderRequests } from "./reminders/parser.js";

test("parseReminderRequests supports multiple times with same day hint", () => {
  const base = new Date(2026, 0, 22, 20, 0, 0, 0).getTime();
  const out = parseReminderRequests("明天9点半，10点半，12点半提醒我喝水", base);
  assert.ok(out && out.length === 3);
  const hm = out!.map((r) => {
    const d = new Date(r.dueAtMs);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  assert.deepEqual(hm, ["9:30", "10:30", "12:30"]);
  assert.equal(out![0]!.message, "喝水");
});

test("isSelfReminderRequest prefers self even with other mentions", async () => {
  const mod = await import("./reminders/parser.js");
  assert.equal(mod.isSelfReminderRequest("@123 明天9点提醒我喝水"), true);
});
