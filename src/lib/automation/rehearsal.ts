import { randomUUID } from "node:crypto";
import { rehearsalTicket } from "./security";
import { mutateAutomation, readAutomation } from "./storage";
import { addEvent, parseEvent, record, text } from "./model";
import { AgentRequestError, deleteAgentSession } from "./agent-session";

export function rehearsalBase() {
  const url = new URL(process.env.REHEARSAL_BASE_URL || "https://unconfigured.invalid");
  if (!process.env.REHEARSAL_BASE_URL || url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("REHEARSAL_BASE_URL に公開HTTPSオリジンを設定してください。");
  return url.origin;
}
class AgentsError extends AgentRequestError {
  constructor(message: string, public definite: boolean, status: number) { super(message, status); }
}
async function agents(path: string, body?: unknown, method = body ? "POST" : "GET", signal?: AbortSignal): Promise<Record<string, unknown>> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY の設定が必要です。");
  const response = await fetch(`https://api.openai.com/v1/agents/sessions${path}`, { method, headers: { Authorization: `Bearer ${key}`, "OpenAI-Beta": "agents=v1", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: signal ?? AbortSignal.timeout(45000) });
  if (!response.ok) throw new AgentsError(response.status === 429 ? "Agents APIの利用枠に達しました。" : "Agents APIの応答を確認できません。権限・設定を確認してください。", response.status >= 400 && response.status < 500 && response.status !== 408, response.status);
  if (method === "DELETE" && response.status === 204) return {};
  const raw = await response.text();
  return raw ? record(JSON.parse(raw)) : {};
}
function sessionPath(id: string) { return `/${encodeURIComponent(id)}`; }
export async function startRehearsal(owner: string, runId: string) {
  const origin = rehearsalBase();
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY の設定が必要です。");
  const reserved = await mutateAutomation((state) => {
    const existing = state.runs.find((r) => r.id === runId && r.owner === owner);
    if (existing) return { created: false, run: existing };
    if (state.runs.some((r) => r.owner === owner && !["deleted", "failed"].includes(r.state))) throw new Error("前のAgentsセッションを削除してから開始してください。結果不明の実行は管理者による確認が必要です。");
    const run = { id: runId, owner, createdAt: Date.now(), state: "creating" as const };
    state.runs = state.runs.slice(-19).concat(run);
    return { created: true, run };
  });
  if (!reserved.created) return reserved.run;
  const url = `${origin}/rehearsal?ticket=${rehearsalTicket()}`;
  let sessionId: string | undefined;
  try {
    const session = await agents("", {
      agent: { model: process.env.REHEARSAL_MODEL || "gpt-6.1-sol", instructions: "DJ/VJ Studioの隔離リハーサル画面を操作する。指定URLの /rehearsal のみで作業する。ログイン、外部サイトへの移動、本番Studioの操作、音源やアカウントへのアクセスは行わない。画面で確認できた結果だけを日本語で報告する。失敗や未確認を成功と報告しない。", tools: [{ type: "computer_use", include_screenshots: true }] },
      environment: { type: "openai_hosted", desktop: { enabled: true }, network: { access: "enabled" } },
      metadata: { djvj_run_id: runId },
      input: `次の隔離リハーサル画面を開く: ${url}\n「自動リハーサル開始」をクリックし、完了まで待つ。成功・失敗の件数と失敗したチェック名を読む。「DevDay キーノート」「ディープ」の場面を順に切り替え、プレビューを確認する。操作できなかった項目も明記し、最後に結果を日本語で報告する。音声・実機・本番データは検証対象外。`,
    });
    sessionId = text(session.id, 256);
    await mutateAutomation((state) => { const run = state.runs.find((r) => r.id === runId && r.owner === owner)!; run.sessionId = sessionId; run.state = "running"; });
    return { id: runId, sessionId, state: "running" };
  } catch (error) {
    // A timeout can mean creation succeeded. Never automatically create a second session.
    const definite = !sessionId && error instanceof AgentsError && error.definite;
    await mutateAutomation((state) => { const run = state.runs.find((r) => r.id === runId && r.owner === owner)!; run.state = definite ? "failed" : "unknown"; if (sessionId) run.sessionId = sessionId; run.error = definite ? "APIが作成を拒否しました。権限・利用枠を確認して再実行してください。" : "作成結果が不明です。OpenAI側のセッションを確認し、実行IDに対応するセッションIDで復旧してください。"; });
    if (definite) throw error;
    throw new Error("セッション作成の結果が不明です。設定・OpenAI側の状態を確認してください。");
  }
}
export async function recoverRehearsal(owner: string, id: string, sessionId: string) {
  const run = (await readAutomation()).runs.find((r) => r.id === id && r.owner === owner && r.state === "unknown");
  if (!run) throw new Error("復旧対象の実行がありません。");
  const session = await agents(sessionPath(sessionId));
  if (record(session.metadata).djvj_run_id !== id) throw new Error("この実行IDに対応するセッションではありません。");
  await mutateAutomation((state) => { const target = state.runs.find((r) => r.id === id && r.owner === owner)!; target.sessionId = sessionId; target.state = "running"; delete target.error; });
}
async function ownRun(owner: string, id: string) {
  const run = (await readAutomation()).runs.find((r) => r.id === id && r.owner === owner && r.state !== "deleted");
  if (!run?.sessionId) throw new Error("取得できるセッションがありません。");
  return run;
}
async function history(path: string) {
  const items: Record<string, unknown>[] = [];
  let after = "";
  for (let page = 0; page < 10; page++) {
    const result = await agents(`${path}?order=asc&limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    if (!Array.isArray(result.data)) throw new Error("履歴を読み取れません。");
    items.push(...result.data.map(record));
    if (!result.has_more) return { items, truncated: false };
    after = text(result.last_id, 256);
  }
  return { items, truncated: true };
}
export async function inspectRehearsal(owner: string, id: string) {
  const run = await ownRun(owner, id), path = sessionPath(run.sessionId!);
  const [session, saved, turns] = await Promise.all([agents(path), history(`${path}/items`), history(`${path}/turns`)]);
  const output = saved.items.filter((i) => i.type === "message").flatMap((i) => Array.isArray(i.content) ? i.content.map(record) : []).filter((c) => c.type === "output_text" && typeof c.text === "string").map((c) => (c.text as string).slice(0, 12000)).join("\n");
  const activity = saved.items.filter((i) => i.type === "computer_use_call").map((i) => ({ id: i.id, title: typeof i.title === "string" ? i.title.slice(0, 300) : "ブラウザ操作", status: i.status }));
  const required = (Array.isArray(session.required_actions) ? session.required_actions : []).map(record).filter((a) => a.type === "computer_use_approval_request").map((a) => {
    const request = record(a.request);
    return { requestId: a.request_id, type: request.type, origin: request.origin, reason: typeof request.reason === "string" ? request.reason.slice(0, 500) : "", canApprove: request.type === "browser_origin_access" && request.origin === rehearsalBase() };
  });
  const lastTurn = turns.items.at(-1);
  let eventRecorded = false;
  if (!turns.truncated && session.status === "idle" && lastTurn && ["completed", "failed", "cancelled"].includes(String(lastTurn.status))) {
    eventRecorded = await mutateAutomation((state) => {
      const current = state.runs.find((r) => r.id === id && r.owner === owner);
      if (!current || current.reported) return false;
      state.subscriptions = state.subscriptions.filter((s) => s.owner === owner && s.expires > Date.now());
      addEvent(state, parseEvent({ eventId: `evt_${id}`, name: "rehearsal.completed", data: { studioId: process.env.REHEARSAL_STUDIO_ID || "main", title: `Agentsリハーサル終了: ${String(lastTurn.status)}`, detail: (`実行ID: ${id}\n${output || "出力なし。履歴を確認してください。"}`).slice(0, 2000) } }));
      current.reported = true;
      return true;
    });
  }
  return { id, state: session.status, output, activity, required, eventRecorded, turns: turns.items.map((t) => ({ id: t.id, status: t.status })), truncated: saved.truncated || turns.truncated };
}
export async function approveRehearsal(owner: string, id: string, requestId: string, decision: string) {
  const run = await ownRun(owner, id), path = sessionPath(run.sessionId!);
  const session = await agents(path);
  const action = (Array.isArray(session.required_actions) ? session.required_actions : []).map(record).find((a) => a.type === "computer_use_approval_request" && a.request_id === requestId);
  if (!action) throw new Error("承認要求が更新されました。再取得してください。");
  const request = record(action.request);
  let response;
  if (request.type === "browser_origin_access") {
    if (decision === "approve" && request.origin !== rehearsalBase()) throw new Error("検証用オリジン以外は許可できません。");
    if (!["approve", "deny", "cancel"].includes(decision)) throw new Error("判断が不正です。");
    response = { type: "browser_origin_access", decision };
  } else if (request.type === "browser_authentication") response = { type: "browser_authentication", action: "cancel" };
  else throw new Error("対応していない承認要求です。");
  await agents(`${path}/events`, { events: [{ type: "agent.session.input.computer_use_approval_request_result", request_id: requestId, response }] });
}
export async function deleteRehearsal(owner: string, id: string) {
  const run = await ownRun(owner, id);
  await deleteAgentSession(agents, sessionPath(run.sessionId!));
  await mutateAutomation((state) => { const target = state.runs.find((r) => r.id === id && r.owner === owner); if (target) target.state = "deleted"; });
}
export const newRunId = () => `run_${randomUUID()}`;
