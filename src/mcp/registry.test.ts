import test from "node:test";
import assert from "node:assert/strict";
import { filterMcpTools } from "./registry.js";

test("filterMcpTools: denylist (false disables only)", () => {
  const tools = [
    { server: "s", name: "a" },
    { server: "s", name: "b" }
  ];
  const out = filterMcpTools(tools as any, { a: false });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "b");
});

test("filterMcpTools: allowlist (any true enables only true)", () => {
  const tools = [
    { server: "s", name: "a" },
    { server: "s", name: "b" }
  ];
  const out = filterMcpTools(tools as any, { a: true });
  assert.deepEqual(out.map((t) => t.name), ["a"]);
});

test("filterMcpTools: empty config keeps all", () => {
  const tools = [
    { server: "s", name: "a" },
    { server: "s", name: "b" }
  ];
  const out = filterMcpTools(tools as any, {});
  assert.deepEqual(out.map((t) => t.name).sort(), ["a", "b"]);
});

