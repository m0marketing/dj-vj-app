import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "djvj_session";
export const SESSION_SECONDS = 60 * 60 * 24 * 7;

export function authConfigured() {
  return /^[a-f0-9]{64}$/i.test(process.env.ACCESS_CODE_HASH ?? "") && (process.env.AUTH_SECRET?.length ?? 0) >= 32;
}

export function hashAccessCode(code: string) {
  return createHash("sha256").update(code.trim()).digest("hex");
}

function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function checkAccessCode(code: unknown) {
  return authConfigured() && typeof code === "string" && code.trim().length > 0 && code.length <= 256 && equal(hashAccessCode(code), process.env.ACCESS_CODE_HASH!.toLowerCase());
}

function sign(payload: string) {
  // Rotating either secret or access code also invalidates existing sessions.
  return createHmac("sha256", process.env.AUTH_SECRET!).update(`${process.env.ACCESS_CODE_HASH!.toLowerCase()}:${payload}`).digest("base64url");
}

export function createSession(now = Date.now()) {
  if (!authConfigured()) throw new Error("Access code authentication is not configured");
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_SECONDS, nonce: randomBytes(16).toString("hex") })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token: string | undefined, now = Date.now()) {
  if (!authConfigured() || !token || token.length > 512) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !equal(sign(parts[0]), parts[1])) return false;
  try {
    const { exp, nonce } = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const seconds = Math.floor(now / 1000);
    return Number.isInteger(exp) && exp > seconds && exp <= seconds + SESSION_SECONDS && typeof nonce === "string" && /^[a-f0-9]{32}$/.test(nonce);
  } catch {
    return false;
  }
}

export function safeNext(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return "/";
  try {
    const url = new URL(value, "https://studio.invalid");
    if (url.origin !== "https://studio.invalid" || url.pathname === "/login" || url.pathname.startsWith("/api/")) return "/";
    return url.pathname + url.search;
  } catch {
    return "/";
  }
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}
