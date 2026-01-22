import test from "node:test";
import assert from "node:assert/strict";
import { parseToolCallFromText } from "./toolCall.js";

test("parseToolCallFromText parses one-line JSON", () => {
  const t = parseToolCallFromText('{"tool":"rag_search","arguments":{"query":"hi","top_k":3}}');
  assert.deepEqual(t, { tool: "rag_search", arguments: { query: "hi", top_k: 3 } });
});

test("parseToolCallFromText parses fenced JSON", () => {
  const t = parseToolCallFromText('```json\n{"tool":"x","arguments":{}}\n```');
  assert.deepEqual(t, { tool: "x", arguments: {} });
});

test("parseToolCallFromText extracts embedded JSON", () => {
  const t = parseToolCallFromText('hello\n{"tool":"x","arguments":{"a":1}}\nbye');
  assert.deepEqual(t, { tool: "x", arguments: { a: 1 } });
});

