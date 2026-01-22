import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./fs.js";

export function appendJsonl(filePath: string, record: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

export function readJsonl<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf8");
  return content
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean)
    .map((line: string) => JSON.parse(line) as T);
}

