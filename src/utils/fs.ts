import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function projectRootDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let cur = here;
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(cur, "package.json");
    if (fs.existsSync(pkg)) return cur;
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return path.resolve(here, "../../..");
}

export function resolveFromCwd(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

export function resolveFromProjectRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(projectRootDir(), p);
}
