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

test("parseReminderRequests supports hours and days delay", () => {
  const base = new Date(2026, 0, 22, 12, 0, 0, 0).getTime();
  const r1 = parseReminderRequests("2小时后提醒我休息", base);
  assert.ok(r1 && r1.length === 1);
  assert.equal(r1![0]!.dueAtMs, base + 2 * 60 * 60 * 1000);

  const r2 = parseReminderRequests("2天后提醒我交房租", base);
  assert.ok(r2 && r2.length === 1);
  assert.equal(r2![0]!.dueAtMs, base + 2 * 24 * 60 * 60 * 1000);

  const r3 = parseReminderRequests("1天2小时后提醒我打电话", base);
  assert.ok(r3 && r3.length === 1);
  assert.equal(r3![0]!.dueAtMs, base + (1 * 24 * 60 + 2 * 60) * 60 * 1000);
});

test("parseReminderRequests supports 以后/之后", () => {
  const base = new Date(2026, 0, 22, 12, 0, 0, 0).getTime();
  const r1 = parseReminderRequests("10分钟以后提醒我喝水", base);
  assert.ok(r1 && r1.length === 1);
  assert.equal(r1![0]!.dueAtMs, base + 10 * 60 * 1000);
});
