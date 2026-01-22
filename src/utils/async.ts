export type TimeoutError = Error & { code?: string };

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Error(`${label} timed out after ${ms}ms`) as TimeoutError;
  timeout.code = "ETIMEDOUT";
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(timeout), ms);
    })
  ]);
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function errorMessage(e: unknown): string {
  if (!e) return "unknown error";
  if (e instanceof Error) return e.message || String(e);
  return String(e);
}
