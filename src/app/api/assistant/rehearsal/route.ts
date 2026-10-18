import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, SESSION_COOKIE, verifySession } from "@/lib/auth";
import { rehearsalTicket } from "@/lib/automation/security";
import { boundedJson } from "@/lib/automation/http";
export const maxDuration = 60;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const signature = (value: string) => createHmac("sha256", process.env.AUTH_SECRET!).update(`rehearsal-session:${value}`).digest("base64url");
function proof(id: string, origin: string) { const value = Buffer.from(JSON.stringify({ id, origin, exp: Date.now() + 3600000 })).toString("base64url"); return `${value}.${signature(value)}`; }
function recover(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("セッション情報が必要です。");
  const [body, sig, extra] = value.split(".");
  const expected = signature(body || "");
  if (!sig || extra || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error("セッション情報が不正です。");
  const data = JSON.parse(Buffer.from(body, "base64url").toString());
  if (typeof data.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(data.id) || typeof data.origin !== "string" || !Number.isFinite(data.exp) || data.exp < Date.now()) throw new Error("セッション情報の期限が切れました。");
  return data as { id: string; origin: string };
}
async function agents(path: string, body?: unknown, method = body ? "POST" : "GET") {
  const response = await fetch(`https://api.openai.com/v1/agents/sessions${path}`, { method, headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "OpenAI-Beta": "agents=v1", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45000), cache: "no-store" });
  if (!response.ok) throw new Error(`Agents API (${response.status})：利用権限・利用枠を確認してください。`);
  return response.status === 204 ? {} : await response.json();
}
export async function POST(request: NextRequest) {
  if (!verifySession(request.cookies.get(SESSION_COOKIE)?.value)) return json({ error: "ログインが必要です。" }, 401);
  if (!sameOrigin(request)) return json({ error: "この画面から操作してください。" }, 403);
  if (!process.env.OPENAI_API_KEY?.trim()) return json({ error: "サーバーに OPENAI_API_KEY を設定してください。" }, 503);
  try {
    const input = await boundedJson(request) as Record<string, unknown>;
    if (input.action === "start") {
      const origin = new URL(process.env.REHEARSAL_BASE_URL || request.url).origin;
      if (!origin.startsWith("https://")) return json({ error: "リハーサルには公開HTTPS URLが必要です。" }, 400);
      const session = await agents("", { agent: { model: "gpt-6-astra", instructions: "指定された隔離リハーサル画面のみを操作。音声品質や実機を検証したと主張せず、画面で確認できた成功と失敗を日本語で報告。ログイン・本番Studio・外部サイトは操作しない。", tools: [{ type: "computer_use", include_screenshots: true }] }, environment: { type: "openai_hosted", desktop: { enabled: true }, network: { access: "enabled" } } });
      const token = proof(session.id, origin);
      // Return the capability before sending the task: refreshes can recover the same session without creating another.
      return json({ token, sessionId: session.id, state: "created" });
    }
    const { id, origin } = recover(input.token);
    const path = `/${encodeURIComponent(id)}`;
    if (input.action === "run") {
      const stream = await fetch(`https://api.openai.com/v1/agents/sessions${path}/events`, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "OpenAI-Beta": "agents=v1", Accept: "text/event-stream" }, signal: AbortSignal.timeout(45000), cache: "no-store" });
      if (!stream.ok) throw new Error("実行ストリームを開始できませんでした。セッションを確認してください。");
      try { await agents(`${path}/events`, { events: [{ type: "agent.session.input.message", input: [{ role: "user", content: [{ type: "input_text", text: `${origin}/rehearsal?ticket=${rehearsalTicket()} を開き「自動リハーサル開始」を押す。完了後に成功・失敗数とチェック名を確認。「DevDay キーノート」「ディープ」を順に切り替える。結果を日本語で報告。` }] }] }] }); }
      finally { await stream.body?.cancel(); }
      return json({ state: "running" });
    }
    if (input.action === "delete") { await agents(path, undefined, "DELETE"); return json({ state: "deleted" }); }
    const session = await agents(path);
    if (input.action === "approve") {
      const action = session.required_actions?.find((a: { request_id: string }) => a.request_id === input.requestId);
      if (!action || action.request?.type !== "browser_origin_access" || action.request.origin !== origin) throw new Error("この接続先は許可できません。");
      await agents(`${path}/events`, { events: [{ type: "agent.session.input.computer_use_approval_request_result", request_id: input.requestId, response: { type: "browser_origin_access", decision: input.decision === "approve" ? "approve" : "cancel" } }] });
      return json({ state: "running" });
    }
    if (input.action !== "inspect") throw new Error("操作が不正です。");
    const items = await agents(`${path}/items?order=desc&limit=100`);
    const output = (items.data || []).filter((item: { type: string }) => item.type === "message").flatMap((item: { content?: { type: string; text?: string }[] }) => item.content || []).filter((item: { type: string }) => item.type === "output_text").map((item: { text?: string }) => item.text || "").join("\n").slice(0, 16000);
    return json({ state: session.status, output, required: (session.required_actions || []).filter((a: { request?: { type: string; origin: string } }) => a.request?.type === "browser_origin_access" && a.request.origin === origin).map((a: { request_id: string }) => ({ requestId: a.request_id, origin })), activity: (items.data || []).filter((i: { type: string }) => i.type === "computer_use_call").map((i: { title: string; status: string }) => ({ title: i.title, status: i.status })) });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "実行結果が不明です。再作成せず状態を確認してください。" }, 502); }
}
