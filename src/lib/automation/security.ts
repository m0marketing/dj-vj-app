import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function bearerOwner(request: Request) {
  const token = process.env.AUTOMATION_TOKEN?.trim();
  if (!token || token.length < 32 || !equal(request.headers.get("authorization") ?? "", `Bearer ${token}`)) return null;
  return createHash("sha256").update(token).digest("hex");
}
export function subscriptionId(owner: string, url: string, name: string, studioId: string) {
  return `sub_${createHash("sha256").update(JSON.stringify([owner, url, name, { studioId }])).digest("hex").slice(0, 32)}`;
}
export function validSecret(value: unknown): string {
  if (typeof value !== "string" || !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("署名鍵は whsec_ 形式で指定してください。");
  const bytes = Buffer.from(value.slice(6), "base64");
  if (bytes.length < 24 || bytes.length > 64 || bytes.toString("base64").replace(/=+$/, "") !== value.slice(6).replace(/=+$/, "")) throw new Error("署名鍵の長さが不正です。");
  return value;
}
export function webhookHeaders(id: string, body: string, sub: { id: string; secret: string; oldSecret?: string; rotationUntil?: number }, now = Date.now()) {
  const timestamp = String(Math.floor(now / 1000));
  const secrets = [sub.secret, ...(sub.oldSecret && (sub.rotationUntil ?? 0) > now ? [sub.oldSecret] : [])];
  return { "Content-Type": "application/json", "webhook-id": id, "webhook-timestamp": timestamp, "X-MCP-Subscription-Id": sub.id,
    "webhook-signature": secrets.map((secret) => `v1,${createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${timestamp}.${body}`).digest("base64")}`).join(" ") };
}
/** Conservative public-address policy, including IPv4-mapped IPv6 and transition ranges. */
export function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    return /^[23][0-9a-f]{3}:/.test(a) && !a.startsWith("2001:") && !a.startsWith("2002:") && !a.startsWith("3fff:");
  }
  return false;
}
export function callbackUrl(value: unknown, hosts = (process.env.MCP_CALLBACK_HOSTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("通知先URLが不正です。");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443") || isIP(url.hostname) || !hosts.includes(url.hostname.toLowerCase())) throw new Error("通知先は MCP_CALLBACK_HOSTS に登録したHTTPSホストに限定されます。");
  return url;
}
export function rehearsalTicket(now = Date.now()) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("認証設定が必要です。");
  const payload = Buffer.from(JSON.stringify({ scope: "rehearsal", exp: now + 15 * 60000, nonce: randomBytes(12).toString("hex") })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
export function verifyRehearsalTicket(value: string | null, now = Date.now()) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || !value || value.length > 512) return false;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra || !equal(createHmac("sha256", secret).update(payload).digest("base64url"), signature)) return false;
  try { const p = JSON.parse(Buffer.from(payload, "base64url").toString()); return p.scope === "rehearsal" && typeof p.exp === "number" && p.exp > now && p.exp <= now + 15 * 60000; } catch { return false; }
}
