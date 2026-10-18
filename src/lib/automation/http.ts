import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, SESSION_COOKIE, verifySession } from "@/lib/auth";
import { bearerOwner } from "./security";

export const automationJson = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
export function authorizeAutomation(request: NextRequest, write = false) {
  if (bearerOwner(request)) return null;
  if (!verifySession(request.cookies.get(SESSION_COOKIE)?.value)) return automationJson({ error: "ログインが必要です。" }, 401);
  if (write && !sameOrigin(request)) return automationJson({ error: "この画面から操作してください。" }, 403);
  return null;
}
export async function boundedJson(request: Request, max = 16384) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("入力が必要です。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel(); throw new Error("入力が長すぎます。"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let i = 0;
  for (const chunk of chunks) { bytes.set(chunk, i); i += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("JSONの形式が不正です。"); }
}
