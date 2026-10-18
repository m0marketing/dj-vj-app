"use client";
import { useEffect, useRef, useState } from "react";
import { useDJ } from "@/lib/store";
import { featureBus } from "@/lib/vj/featureBus";
import { SCENES, type AssistantResult } from "@/lib/ai/assistant";

export default function AIDirector() {
  const ready = useDJ((s) => s.ready);
  const [enabled, setEnabled] = useState(false);
  const [intent, setIntent] = useState("DevDayのイベント。曲の盛り上がりに合わせて映像を切り替える。ストロボは使わない。");
  const [message, setMessage] = useState("");
  const latest = useRef({ level: 0, bass: 0, mid: 0, high: 0, bpm: 0 });
  useEffect(() => featureBus.subscribe(({ features: f }) => { latest.current = { level: f.level, bass: f.bass, mid: f.mid, high: f.high, bpm: f.bpm ?? 0 }; }), []);
  useEffect(() => {
    if (!enabled || !ready) return;
    const controller = new AbortController();
    let busy = false;
    const decide = async () => {
      const s = useDJ.getState();
      if (busy || (!s.decks.A.playing && !s.decks.B.playing)) return;
      busy = true;
      try {
        setMessage("次の演出を判断中…");
        const response = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "scene", prompt: `${intent.slice(0, 600)}\n音声特徴量（0〜1の帯域値）:${JSON.stringify(latest.current)}。現在の場面:${s.activeLook}。音源自体は提供していない。場面だけ選択する。` }), signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "演出を取得できません。");
        const result = data.result as AssistantResult;
        if (!controller.signal.aborted && result.kind === "scene" && SCENES.some((scene) => scene.id === result.lookId)) {
          const current = useDJ.getState();
          if (current.activeLook !== result.lookId) current.applyLook(result.lookId);
          current.setVJ({ strobe: false });
          setMessage(`${SCENES.find((scene) => scene.id === result.lookId)?.name} · 次の小節で反映`);
        }
      } catch (error) { if (!controller.signal.aborted) { setMessage(error instanceof Error ? error.message : "接続を確認してください。"); setEnabled(false); } }
      finally { busy = false; }
    };
    const first = setTimeout(() => void decide(), 2000);
    const timer = setInterval(() => void decide(), 30000);
    return () => { controller.abort(); clearTimeout(first); clearInterval(timer); };
  }, [enabled, ready, intent]);
  return <details className="panel p-3"><summary className="cursor-pointer text-sm font-semibold text-accent">AI 演出ディレクター</summary><div className="mt-3 flex flex-col gap-3 text-xs"><label>演出の方針<textarea className="mt-1 w-full rounded border border-border bg-panel-2 p-2" maxLength={600} value={intent} disabled={enabled} onChange={(e) => setIntent(e.target.value)} /></label><p className="text-zinc-400">再生中、30秒ごとに音声特徴量と方針をOpenAIへ送り、次の小節でLookを切り替えます。API料金が発生します。音源は送信しません。</p><button className={`btn self-start ${enabled ? "btn-accent" : ""}`} disabled={!ready || !intent.trim()} aria-pressed={enabled} onClick={() => { setEnabled((v) => !v); setMessage(""); }}>{enabled ? "AI自動演出を停止" : "AI自動演出を開始"}</button><p aria-live="polite">{message}</p></div></details>;
}
