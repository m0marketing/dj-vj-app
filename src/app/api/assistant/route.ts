import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, SESSION_COOKIE, verifySession } from "@/lib/auth";
import { decisionRequest, parseAssistantRequest, parseAssistantResult, setlistRequest } from "@/lib/ai/assistant";

export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
// Best-effort per-instance throttle. Platform-level quotas still apply across instances.
const requests = new Map<string, { until: number; count: number; busy: boolean }>();
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

export function GET(request: NextRequest) {
  if (!verifySession(request.cookies.get(SESSION_COOKIE)?.value)) return json({ error: "ログインが必要です。" }, 401);
  return json({ configured: !!process.env.OPENAI_API_KEY?.trim() });
}

async function readInput(request: Request) {
  // Bound the actual stream as well as Content-Length (which clients can omit).
  const reader = request.body?.getReader();
  if (!reader) throw new Error("依頼を入力してください。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65536) { await reader.cancel(); throw new Error("送信する曲数や文字数を減らしてください。"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("入力の形式を確認してください。"); }
}

export async function POST(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!verifySession(session)) return json({ error: "ログインが必要です。" }, 401);
  if (!sameOrigin(request)) return json({ error: "この画面から操作してください。" }, 403);
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return json({ error: "AI アシストは未設定です。管理者がサーバーの OPENAI_API_KEY を設定すると使えます。" }, 503);
  let input;
  try { input = parseAssistantRequest(await readInput(request)); } catch (error) { return json({ error: error instanceof Error ? error.message : "入力を確認してください。" }, 400); }
  const now = Date.now();
  for (const [id, entry] of requests) if (entry.until < now && !entry.busy) requests.delete(id);
  const entry = requests.get(session!) ?? { until: now + 60_000, count: 0, busy: false };
  if (entry.busy || entry.count >= 6 || requests.size >= 1000) return json({ error: "少し待ってからもう一度お試しください。" }, 429);
  entry.count++;
  entry.busy = true;
  requests.set(session!, entry);
  try {
    const response = await fetch(`https://api.openai.com/v1/${input.kind === "scene" ? "decisions" : "responses"}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(input.kind === "scene" ? decisionRequest(input) : setlistRequest(input)),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(50_000)]),
      cache: "no-store",
    });
    if (!response.ok) {
      if (response.status === 429) return json({ error: "OpenAI API の利用枠またはレート上限に達しました。時間を置くか、管理者に利用枠を確認してください。" }, 429);
      if (response.status === 401 || response.status === 403 || response.status === 404) return json({ error: "OpenAI API のキーまたはモデルの利用権限を管理者に確認してください。" }, 502);
      return json({ error: "OpenAI API に接続できませんでした。時間を置いてお試しください。" }, 502);
    }
    let result;
    try { result = parseAssistantResult(input, await response.json()); } catch (error) { return json({ error: error instanceof Error ? error.message : "提案を読み取れませんでした。" }, 502); }
    return json({ result });
  } catch {
    return json({ error: "AI の応答を取得できませんでした。接続を確認してもう一度お試しください。" }, 504);
  } finally { entry.busy = false; }
}
