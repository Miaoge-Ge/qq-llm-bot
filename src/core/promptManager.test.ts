import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PromptManager } from "./promptManager.js";
import { resolveFromProjectRoot } from "../utils/fs.js";

function evtGroup(groupId: string) {
  return {
    platform: "napcatqq",
    chatType: "group",
    messageId: "m1",
    userId: "u1",
    groupId,
    replyToMessageId: undefined,
    segments: [],
    text: "",
    timestampMs: Date.now(),
    raw: {}
  } as any;
}

test("PromptManager merges SYSTEM_PROMPT with group prompt", () => {
  const promptsDir = resolveFromProjectRoot("prompts");
  const tmpId = `tmp_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const tmpFile = path.join(promptsDir, `${tmpId}.txt`);
  const mapFile = path.join(os.tmpdir(), `group-prompts-${Date.now()}.json`);

  try {
    fs.writeFileSync(tmpFile, "GROUP_PROMPT", "utf8");
    fs.writeFileSync(mapFile, JSON.stringify({ groups: { "1": tmpId } }), "utf8");
    const pm = new PromptManager({ SYSTEM_PROMPT: "BASE_PROMPT", GROUP_PROMPT_MAP_FILE: mapFile } as any);
    const out = pm.getPromptForEvent(evtGroup("1"));
    assert.equal(out, "BASE_PROMPT\n\nGROUP_PROMPT");
  } finally {
    try {
      fs.rmSync(tmpFile);
    } catch {}
    try {
      fs.rmSync(mapFile);
    } catch {}
  }
});

test("PromptManager supports multiple prompt ids for a group", () => {
  const promptsDir = resolveFromProjectRoot("prompts");
  const id1 = `tmp_${Date.now()}_a`;
  const id2 = `tmp_${Date.now()}_b`;
  const f1 = path.join(promptsDir, `${id1}.txt`);
  const f2 = path.join(promptsDir, `${id2}.txt`);
  const mapFile = path.join(os.tmpdir(), `group-prompts-${Date.now()}-multi.json`);

  try {
    fs.writeFileSync(f1, "P1", "utf8");
    fs.writeFileSync(f2, "P2", "utf8");
    fs.writeFileSync(mapFile, JSON.stringify({ groups: { "2": [id1, id2] } }), "utf8");
    const pm = new PromptManager({ SYSTEM_PROMPT: "BASE", GROUP_PROMPT_MAP_FILE: mapFile } as any);
    const out = pm.getPromptForEvent(evtGroup("2"));
    assert.equal(out, "BASE\n\nP1\n\nP2");
  } finally {
    try {
      fs.rmSync(f1);
    } catch {}
    try {
      fs.rmSync(f2);
    } catch {}
    try {
      fs.rmSync(mapFile);
    } catch {}
  }
});
