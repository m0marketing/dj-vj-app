"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EVENT_NAMES, type EventName, type StudioEvent } from "@/lib/automation/model";

interface Status {
  storage: string; mcpConfigured: boolean; agentsConfigured: boolean;
  events?: StudioEvent[]; subscriptions?: { id: string; name: string; studioId: string }[];
  deliveries?: { eventId: string; status: string; attempts: number; nextAt: number }[];
  runs?: { id: string; state: string; sessionId?: string; error?: string }[];
}
interface RunStatus {
  id: string; state: string; output: string; truncated: boolean;
  activity: { id: string; title: string; status: string }[];
  required: { requestId: string; type: string; origin?: string; reason: string; canApprove: boolean }[];
  turns: { id: string; status: string }[];
}
async function api(path: string, body?: unknown) {
  const response = await fetch(path, { method: body ? "POST" : "GET", cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "接続を確認してください。");
  return data;
}
export default function AutomationPanel() {
  const [open, setOpen] = useState(false), [status, setStatus] = useState<Status | null>(null);
  const [name, setName] = useState<EventName>("schedule.updated"), [studioId, setStudioId] = useState("main");
  const [title, setTitle] = useState(""), [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [run, setRun] = useState<RunStatus | null>(null);
  const [recoverySession, setRecoverySession] = useState("");
  const eventId = useRef<string | null>(null), runId = useRef<string | null>(null);
  const refresh = useCallback(async () => { setStatus(await api("/api/automation")); }, []);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void api("/api/automation").then((data) => { if (active) setStatus(data); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [open]);
  useEffect(() => {
    if (!open || !run || run.state === "failed" || (run.state === "idle" && run.turns.some((t) => ["completed", "failed", "cancelled"].includes(t.status)))) return;
    let active = true;
    const timer = setTimeout(() => { void api(`/api/automation/rehearsal?id=${encodeURIComponent(run.id)}`).then((data) => { if (active) setRun(data); }).catch((e) => { if (active) setError(e.message); }); }, 4000);
    return () => { active = false; clearTimeout(timer); };
  }, [open, run]);
  async function perform(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "操作に失敗しました。"); }
    finally { setBusy(false); }
  }
  const latest = status?.runs?.find((r) => !["deleted", "failed"].includes(r.state));
  const clearEvent = () => { eventId.current = null; };
  return <details className="panel p-3" onToggle={(e) => setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-semibold text-accent">イベント連携・自動リハーサル</summary>
    {open && <div className="mt-3 grid min-w-0 gap-4 lg:grid-cols-2">
      <form className="flex min-w-0 flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void perform(async () => {
        eventId.current ??= `evt_${crypto.randomUUID()}`;
        const result = await api("/api/automation", { eventId: eventId.current, name, data: { studioId, title, detail } });
        setMessage(result.created ? "イベントを保存しました。購読先への配信状況を下に表示します。" : "保存済みのイベントです。重複登録はしていません。");
        await refresh();
      }); }}>
        <p className="text-sm font-medium">MCP Events</p>
        <p className="text-xs leading-relaxed text-zinc-400">進行表の変更や希望曲を記録し、購読しているChatGPTに通知します。音源は送信しません。演出・再生の変更案は会話で確認できます。</p>
        <label className="flex flex-col gap-1 text-xs">イベント<select className="rounded border border-border bg-panel-2 p-2" value={name} onChange={(e) => { setName(e.target.value as EventName); clearEvent(); }}>{EVENT_NAMES.map((n) => <option key={n}>{n}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-xs">Studio ID<input className="rounded border border-border bg-panel-2 p-2" maxLength={64} pattern="[a-zA-Z0-9_-]+" required value={studioId} onChange={(e) => { setStudioId(e.target.value); clearEvent(); }} /></label>
        <label className="flex flex-col gap-1 text-xs">件名<input className="rounded border border-border bg-panel-2 p-2" maxLength={160} required value={title} onChange={(e) => { setTitle(e.target.value); clearEvent(); }} placeholder="例: 登壇開始を10分後ろへ変更" /></label>
        <label className="flex flex-col gap-1 text-xs">内容<textarea className="min-h-20 rounded border border-border bg-panel-2 p-2" maxLength={2000} required value={detail} onChange={(e) => { setDetail(e.target.value); clearEvent(); }} /></label>
        <div className="flex flex-wrap gap-2"><button className="btn btn-primary" disabled={busy || status?.storage === "unconfigured"}>イベントを記録・通知</button><button className="btn" type="button" disabled={busy || status?.storage === "unconfigured"} onClick={() => void perform(async () => { const result = await api("/api/automation/dispatch", {}); setMessage(`配信成功 ${result.sent} 件 / 未成功 ${result.failed} 件`); await refresh(); })}>配信待ちを再送</button></div>
        {status && <p className="text-[11px] text-zinc-400">保存: {status.storage} · 有効な購読 {status.subscriptions?.length ?? 0} 件{!status.mcpConfigured && " · ChatGPTへの接続設定が必要です"}</p>}
        <ul className="max-h-32 overflow-auto text-[11px] text-zinc-400">{status?.deliveries?.slice(-8).reverse().map((d, i) => <li key={`${d.eventId}-${i}`}>{d.eventId.slice(0, 16)} · {d.status} · {d.attempts} 回</li>)}</ul>
        <ul className="max-h-36 overflow-auto text-xs text-zinc-400">{status?.events?.slice(0, 5).map((event) => <li key={event.eventId} className="mb-1 break-words">{event.name} · {event.data.title}</li>)}</ul>
      </form>
      <section className="flex min-w-0 flex-col gap-3 text-xs">
        <p className="text-sm font-medium">自動リハーサル</p>
        <p className="leading-relaxed text-zinc-400">隔離画面で全VJプリセットと入力検証を実行できます。Agents実行ではOpenAIのブラウザが同じ画面を操作します。API料金が発生します。</p>
        <a className="btn self-start" href="/rehearsal" target="_blank" rel="noopener noreferrer">隔離リハーサルを開く（API不要）</a>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={busy || !status?.agentsConfigured || !!latest} onClick={() => void perform(async () => {
            runId.current ??= `run_${crypto.randomUUID()}`;
            let result;
            try { result = await api("/api/automation/rehearsal", { action: "start", id: runId.current }); }
            finally { runId.current = null; await refresh(); }
            if (result.state === "running") setRun(await api(`/api/automation/rehearsal?id=${encodeURIComponent(result.id)}`));
          })}>Agentsで開始</button>
          <button className="btn" disabled={busy || !latest?.sessionId} onClick={() => void perform(async () => { if (latest) setRun(await api(`/api/automation/rehearsal?id=${encodeURIComponent(latest.id)}`)); })}>進捗・結果を取得</button>
          <button className="btn" disabled={busy || !latest?.sessionId} onClick={() => void perform(async () => { if (latest) await api("/api/automation/rehearsal", { action: "delete", id: latest.id }); setRun(null); runId.current = null; await refresh(); setMessage("Agentsセッションの削除を要求しました。"); })}>停止・セッション削除</button>
        </div>
        {!status?.agentsConfigured && <p className="text-zinc-400">Agents実行には OPENAI_API_KEY と REHEARSAL_BASE_URL の設定が必要です。</p>}
        {latest?.error && <p className="text-amber-300">{latest.error}</p>}
        {latest?.state === "unknown" && <div className="flex flex-col gap-2"><p className="break-all text-zinc-400">実行ID: {latest.id}</p><label>対応するOpenAIセッションID<input className="mt-1 w-full rounded border border-border bg-panel-2 p-2" value={recoverySession} maxLength={256} onChange={(e) => setRecoverySession(e.target.value)} /></label><button className="btn self-start" disabled={busy || !recoverySession.trim()} onClick={() => void perform(async () => { await api("/api/automation/rehearsal", { action: "recover", id: latest.id, sessionId: recoverySession.trim() }); await refresh(); setRun(await api(`/api/automation/rehearsal?id=${encodeURIComponent(latest.id)}`)); })}>セッションを照合して復旧</button></div>}
        {run && <div className="flex flex-col gap-2 rounded border border-border p-2" aria-live="polite">
          <p>状態: {run.state} · {run.turns.map((t) => t.status).join(", ")}</p>
          {run.required.map((a) => <div key={a.requestId} className="flex flex-col gap-1"><p className="break-all">接続要求: {a.origin || a.type}</p><p className="text-zinc-400">{a.reason}</p><div className="flex gap-2">{a.canApprove && <button className="btn" disabled={busy} onClick={() => void perform(async () => { await api("/api/automation/rehearsal", { action: "approve", id: run.id, requestId: a.requestId, decision: "approve" }); setRun(await api(`/api/automation/rehearsal?id=${encodeURIComponent(run.id)}`)); })}>この接続を許可</button>}<button className="btn" disabled={busy} onClick={() => void perform(async () => { await api("/api/automation/rehearsal", { action: "approve", id: run.id, requestId: a.requestId, decision: "cancel" }); setRun(await api(`/api/automation/rehearsal?id=${encodeURIComponent(run.id)}`)); })}>拒否</button></div></div>)}
          <ul className="max-h-32 overflow-y-auto text-zinc-400">{run.activity.map((a) => <li key={a.id}>{a.status} · {a.title}</li>)}</ul>
          {run.output && <p className="whitespace-pre-wrap break-words">{run.output}</p>}
          {run.truncated && <p className="text-amber-300">履歴の一部を省略しています。</p>}
          <button className="btn self-start" disabled={!run.output} onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: "application/json" }));
            const a = document.createElement("a"); a.href = url; a.download = "djvj-agent-rehearsal.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>Agents結果JSONを保存</button>
        </div>}
      </section>
      <div className="text-xs lg:col-span-2" aria-live="polite">{busy && <p className="text-zinc-400">処理中…</p>}{message && <p className="text-emerald-300">{message}</p>}{error && <p role="alert" className="text-amber-300">{error}</p>}<button className="mt-2 underline text-zinc-400" disabled={busy} onClick={() => void perform(refresh)}>状態を再取得</button></div>
    </div>}
  </details>;
}
