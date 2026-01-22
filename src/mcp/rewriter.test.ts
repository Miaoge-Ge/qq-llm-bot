import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeModelChatText } from "./reminders/rewriter.js";

test("sanitizeModelChatText removes CQ at and @digits", () => {
  const out = sanitizeModelChatText("[CQ:at,qq=123] hello @456 world @狗群猿");
  assert.equal(out, "hello world 狗群猿");
});
