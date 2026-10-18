"use client";
import { useEffect, useState } from "react";
type Status = { state?: string; output?: string; required?: { requestId: string; origin: string }[]; activity?: { title: string; status: string }[] };
export default function QuickRehearsal() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<Status>({});
  useEffect(() => { setToken(sessionStorage.getItem("djvj-rehearsal") || ""); }, []);
  async function action(action: string, extra = {}, capability = token) {
    const response = await fetch("/api/assistant/rehearsal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, token: capability, ...extra }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "実行できませんでした。");
    return data;
  }
  async function perform(run: () => Promise<void>) { if (busy) return; setBusy(true); setError(""); try { await run(); } catch (e) { setError(e instanceof Error ? e.message : "接続を確認してください。"); } finally { setBusy(false); } }
  return <details className="panel p-3"><summary className="cursor-pointer text-sm font-semibold text-accent">Agents 自動リハーサル</summary><div className="mt-3 flex flex-col gap-3 text-xs"><p>OpenAIのブラウザで隔離画面を操作し、描画・場面切替・入力検証の結果を報告します。API料金が発生します。</p><a className="btn self-start" target="_blank" rel="noopener noreferrer" href="/rehearsal">API不要の隔離リハーサル</a><div className="flex flex-wrap gap-2"><button className="btn btn-primary" disabled={busy || !!token} onClick={() => void perform(async () => { const created = await action("start"); setToken(created.token); sessionStorage.setItem("djvj-rehearsal", created.token); await action("run", {}, created.token); setStatus(await action("inspect", {}, created.token)); })}>Agentsで開始</button><button className="btn" disabled={busy || !token} onClick={() => void perform(async () => setStatus(await action("inspect")))}>進捗・結果を取得</button><button className="btn" disabled={busy || !token} onClick={() => void perform(async () => { await action("delete"); sessionStorage.removeItem("djvj-rehearsal"); setToken(""); setStatus({}); })}>停止・セッション削除</button></div>{status.required?.map((item) => <div key={item.requestId}><p>接続先: {item.origin}</p><button className="btn" disabled={busy} onClick={() => void perform(async () => { await action("approve", { requestId: item.requestId, decision: "approve" }); setStatus(await action("inspect")); })}>この接続を許可</button></div>)}<p aria-live="polite">{busy ? "処理中…" : status.state}</p>{status.activity?.map((item, i) => <p key={i}>{item.status} · {item.title}</p>)}{status.output && <pre className="max-h-80 overflow-auto whitespace-pre-wrap">{status.output}</pre>}{error && <p role="alert" className="text-amber-300">{error}</p>}</div></details>;
}
