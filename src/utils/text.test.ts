import test from "node:test";
import assert from "node:assert/strict";
import { stripSpecificAtMentions } from "./text.js";

test("stripSpecificAtMentions removes only specified ids", () => {
  const out = stripSpecificAtMentions("@111 hello @222 world", ["111"]);
  assert.equal(out, "hello @222 world");
});

