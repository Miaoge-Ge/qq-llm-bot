import crypto from "node:crypto";

export function env(name: string): string | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  return v.trim();
}

export function generateSeniverseSignature(publicKey: string, privateKey: string, ttl = 300): string {
  const ts = Math.floor(Date.now() / 1000);
  const params = `ts=${ts}&ttl=${ttl}&uid=${publicKey}`;
  const digest = crypto.createHmac("sha1", privateKey).update(params).digest("base64");
  const sig = encodeURIComponent(digest);
  return `${params}&sig=${sig}`;
}

