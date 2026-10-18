"use client";

import { useEffect, useRef, useState } from "react";
import { useDJ } from "@/lib/store";
import { MAX_PROMPT, MAX_TRACKS, SCENES, trackForAssistant, type AssistantResult, type AssistantTrack } from "@/lib/ai/assistant";

export default function AIAssistant() {
  const tracks = useDJ((s) => s.tracks);
  const pool = useDJ((s) => s.djPool);
  const autoDJ = useDJ((s) => s.autoDJ);
  const mixing = useDJ((s) => s.mixing);
  const plan = useDJ((s) => s.plan);
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState("");
  const [retry, setRetry] = useState(0);
  const [kind, setKind] = useState<"scene" | "set">("scene");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [sentTracks, setSentTracks] = useState<AssistantTrack[]>([]);
  const [applied, setApplied] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const candidates = scope === "all" ? tracks : tracks.filter((t) => pool.includes(t.id));
  const requestedCount = Math.max(2, Math.min(count, 20, candidates.length));
  const invalidPool = kind === "set" && (candidates.length < 2 || candidates.length > MAX_TRACKS);
  const scene = result?.kind === "scene" ? SCENES.find((s) => s.id === result.lookId) : undefined;
  const missingTracks = result?.kind === "set" && result.tracks.some((t) => !tracks.some((x) => x.id === t.trackId));
  const playbackActive = autoDJ || mixing || !!plan;

  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch("/api/assistant", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("AI の設定を確認できませんでした。ログイン状態と接続を確認してください。");
      const data = await response.json();
      if (!controller.signal.aborted) { setConfigured(data.configured === true); setStatusError(""); }
    }).catch((error) => { if (!controller.signal.aborted) setStatusError(error instanceof Error ? error.message : "接続を確認してください。"); });
    return () => controller.abort();
  }, [open, retry]);

  async function suggest() {
    if (pending.current || !configured || invalidPool || !prompt.trim()) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setResult(null);
    setApplied(false);
    const metadata = kind === "set" ? candidates.map(trackForAssistant) : [];
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "scene" ? { kind, prompt } : { kind, prompt, count: requestedCount, tracks: metadata }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || !data.result) throw new Error(data.error || "提案を取得できませんでした。");
      if (!controller.signal.aborted) { setResult(data.result); setSentTracks(metadata); }
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "接続を確認してください。");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  return (
    <details className="panel p-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-semibold text-accent">AI アシスト <span className="ml-2 text-xs font-normal text-zinc-400">言葉で映像・曲順を相談</span></summary>
      {open && <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <form className="flex min-w-0 flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void suggest(); }}>
          <div className="flex flex-wrap gap-2" role="group" aria-label="AI で相談する内容">
            <button className={`btn ${kind === "scene" ? "btn-accent" : ""}`} type="button" disabled={busy} aria-pressed={kind === "scene"} onClick={() => { setKind("scene"); setResult(null); setError(""); }}>映像の場面</button>
            <button className={`btn ${kind === "set" ? "btn-accent" : ""}`} type="button" disabled={busy} aria-pressed={kind === "set"} onClick={() => { setKind("set"); setResult(null); setError(""); }}>セットリスト</button>
          </div>
          <label className="flex flex-col gap-1 text-xs text-zinc-300">
            {kind === "scene" ? "どんな映像にしますか？" : "どんな曲順にしますか？"}
            <textarea className="min-h-20 w-full resize-y rounded-md border border-border bg-panel-2 p-2 text-sm text-zinc-100" value={prompt} maxLength={MAX_PROMPT} disabled={busy} onChange={(event) => { setPrompt(event.target.value); setResult(null); setApplied(false); }} placeholder={kind === "scene" ? "例: DevDay の登壇前なので、公式配色で落ち着いた映像に" : "例: テンポを少しずつ上げて、最後は落ち着いて終わる曲順に"} />
          </label>
          {kind === "set" && <div className="flex flex-wrap items-center gap-3 text-xs">
            <label>対象 <select className="rounded border border-border bg-panel-2 p-1" value={scope} disabled={busy} onChange={(event) => { setScope(event.target.value as "all" | "selected"); setResult(null); }} aria-label="AI 選曲の対象"><option value="all">ライブラリ全曲</option><option value="selected">Library の選曲対象</option></select></label>
            <span className="text-zinc-400">{candidates.length} 曲</span>
            <label>提案曲数 <input className="w-16 rounded border border-border bg-panel-2 p-1" type="number" min={2} max={Math.max(2, Math.min(20, candidates.length))} value={requestedCount} disabled={busy} onChange={(event) => { setCount(Number(event.target.value)); setResult(null); }} /></label>
          </div>}
          {invalidPool && <p className="text-xs text-amber-300">対象を2〜{MAX_TRACKS}曲にしてください。Library で曲の選曲対象を指定できます。</p>}
          <p className="text-[11px] leading-relaxed text-zinc-400">{kind === "scene" ? "依頼文を OpenAI に送信します。" : "依頼文と対象曲の名前・BPM・キー・長さ・識別子を OpenAI に送信します。音源は送信しません。音を聴かずに曲情報から提案します。"} 提案時に API 利用料金が発生します。</p>
          <div className="flex items-center gap-2">
            <button className="btn btn-primary" type="submit" disabled={!configured || !!statusError || busy || !prompt.trim() || invalidPool}>{busy ? "提案中…" : "提案する"}</button>
            {busy && <button className="btn" type="button" onClick={() => { pending.current?.abort(); setError("リクエストを中止しました。"); }}>中止</button>}
            <span className="text-[10px] text-zinc-500">{kind === "scene" ? "Decisions · GPT-6 Luna" : "GPT-6.1 Sol"}</span>
          </div>
          <div aria-live="polite" className="text-xs leading-relaxed">
            {configured === false && <p className="text-amber-300">AI アシストは未設定です。管理者がサーバーの OPENAI_API_KEY を設定すると利用できます。</p>}
            {configured === null && !statusError && <p className="text-zinc-400">設定を確認中…</p>}
            {statusError && <p className="text-amber-300">{statusError} <button className="underline" type="button" onClick={() => setRetry((n) => n + 1)}>再確認</button></p>}
            {error && <p role="alert" className="text-amber-300">{error}</p>}
          </div>
        </form>
        <div className="min-w-0 rounded-lg border border-border bg-panel-2/50 p-3 text-xs" aria-live="polite" aria-busy={busy}>
          {!result && <p className="leading-relaxed text-zinc-400">{busy ? "条件に合う提案を考えています。" : "ここに提案を表示します。内容を確認してから反映できます。"}</p>}
          {scene && result?.kind === "scene" && <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold">{scene.name}</p>
            <p className="text-zinc-300">{scene.description}</p>
            <p className="text-zinc-400">選択の確信度 {Math.round(result.confidence * 100)}% · 再生中は次の小節頭で切り替わります。</p>
            <button className="btn btn-primary self-start" disabled={applied} onClick={() => { useDJ.getState().applyLook(scene.id); setApplied(true); }}>{applied ? "反映しました" : "この場面に切り替える"}</button>
          </div>}
          {result?.kind === "set" && <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold">{result.title}</p>
            <p className="leading-relaxed text-zinc-300">{result.summary}</p>
            <ol className="flex max-h-64 list-decimal flex-col gap-2 overflow-y-auto pl-5">
              {result.tracks.map((item) => {
                const track = sentTracks.find((t) => t.id === item.trackId);
                return <li key={item.trackId}><p className="break-words font-medium">{track?.name ?? "削除された曲"} <span className="font-normal text-zinc-400">{track?.bpm ? `${track.bpm.toFixed(1)} BPM` : "BPM 未解析"} · {track?.key || "キー未解析"}</span></p><p className="mt-0.5 leading-relaxed text-zinc-400">{item.reason}</p></li>;
              })}
            </ol>
            <p className="text-zinc-400">{result.plan ? `${result.plan.minutes}分 / ${result.tracks.length}曲 · ${SCENES.find((s) => s.id === result.plan?.lookId)?.name}。時間・曲順・映像をまとめて反映します。` : "現在のキューをこの曲順で置き換えます。Auto DJ は別途開始できます。"}</p>
            {playbackActive && <p className="text-amber-300">反映するには Auto DJ・ミックス・セットプランを停止してください。</p>}
            {missingTracks && <p className="text-amber-300">対象曲が削除されました。再度提案してください。</p>}
            <button className="btn btn-primary self-start" disabled={applied || playbackActive || !!missingTracks} onClick={() => { if (useDJ.getState().applySuggestedQueue(result.tracks.map((t) => t.trackId))) { if (result.plan) { useDJ.getState().setPlanInputs(result.plan.minutes, result.tracks.length); useDJ.getState().setPlanCurve(result.plan.curve); useDJ.getState().applyLook(result.plan.lookId); } setApplied(true); } }}>{applied ? "反映しました" : "曲順・プランを反映"}</button>
            {applied && result.plan && <button className="btn btn-primary self-start" disabled={playbackActive} onClick={() => void useDJ.getState().startPlan()}>このセットプランで再生開始</button>}
          </div>}
        </div>
      </div>}
    </details>
  );
}
