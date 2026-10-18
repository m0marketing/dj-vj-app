"use client";

import { useEffect, useState } from "react";
import { autoTarget, beatsFor, effectiveStyle, leadMs, nextDropAfter, snapToPhrase, spentTracks, useDJ } from "@/lib/store";
import type { DeckId } from "@/lib/types";
import VUMeter from "./VUMeter";
import PhraseMeter from "./PhraseMeter";

const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "--:--");

/**
 * Performance dashboard: the few things that matter on stage, in big type - what is playing, what comes next,
 * the countdown to the automatic transition, and the panic / hype buttons. Toggle with Tab or the header button.
 */
export default function LiveView() {
  const open = useDJ((s) => s.liveView);
  const decks = useDJ((s) => s.decks);
  const crossfader = useDJ((s) => s.crossfader);
  const autoDJ = useDJ((s) => s.autoDJ);
  const autoFollow = useDJ((s) => s.autoFollow);
  const autoStyle = useDJ((s) => s.autoStyle);
  const plannedStyle = useDJ((s) => s.plannedStyle);
  const mixBeats = useDJ((s) => s.mixBeats);
  const mixOut = useDJ((s) => s.mixOut);
  const djSegment = useDJ((s) => s.djSegment);
  const mixing = useDJ((s) => s.mixing);
  const plan = useDJ((s) => s.plan);
  const looks = useDJ((s) => s.looks);
  const activeLook = useDJ((s) => s.activeLook);
  const queue = useDJ((s) => s.djQueue);
  const tracks = useDJ((s) => s.tracks);
  const [clock, setClock] = useState("");
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (!open) return;
    const tick = () => {
      setClock(new Date().toLocaleTimeString().slice(0, 5));
      setNowMs(Date.now());
    };
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [open]);
  if (!open) return null;

  const playing = (["A", "B"] as const).filter((id) => decks[id].playing);
  const main: DeckId = playing.length === 1 ? playing[0] : crossfader < 0.5 ? "A" : "B";
  const other: DeckId = main === "A" ? "B" : "A";
  const d = decks[main];
  const n = decks[other];
  let autoIn: number | null = null;
  let style = effectiveStyle(autoStyle, plannedStyle);
  if ((autoFollow || autoDJ) && d.playing && !n.playing && d.duration) {
    let rawTarget = autoDJ ? autoTarget(main, mixOut[main], d.duration, djSegment, d.track?.soundEnd, d.track?.chorusEnd) : Math.min(mixOut[main] ?? d.duration, d.track?.soundEnd ?? d.duration);
    const bpmNow = (d.track?.bpm ?? 120) * d.rate;
    if (style === "doubledrop") {
      const drop = nextDropAfter(d.track, d.position + (4 * 60) / bpmNow);
      if (drop != null) rawTarget = drop;
      else style = "blend";
    }
    const lead = leadMs(style, autoDJ ? beatsFor(djSegment, mixBeats) : mixBeats, bpmNow) / 1000 + (4 * 60) / bpmNow;
    const target = mixOut[main] != null || style === "doubledrop" ? rawTarget : snapToPhrase(rawTarget, d.track, d.position, d.rate, lead, djSegment);
    if (autoDJ || n.track) autoIn = Math.max(0, (target - d.position) / d.rate - lead);
  }
  const s = useDJ.getState();
  const upcoming = queue.slice(0, 3).map((id) => tracks.find((t) => t.id === id)?.name ?? "?");
  const planElapsed = plan && nowMs ? (nowMs - plan.startedAt) / 1000 : 0;

  return (
    <div className="fixed inset-0 z-[45] flex flex-col gap-4 overflow-y-auto bg-black p-4 text-zinc-100 md:p-6" role="dialog" aria-label="本番モード">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="font-mono text-2xl text-zinc-400">{clock}</span>
          {plan && (
            <div className="flex items-center gap-2 text-sm">
              <span className="label">プラン</span>
              <span className="font-mono text-zinc-200">
                {fmt(Math.min(planElapsed, plan.minutes * 60))} / {fmt(plan.minutes * 60)}
              </span>
              <div className="h-2 w-40 overflow-hidden rounded bg-zinc-800">
                <div className="h-full bg-accent" style={{ width: `${Math.min(100, (planElapsed / (plan.minutes * 60)) * 100)}%` }} />
              </div>
              <span className="text-zinc-400">
                {plan.played}/{plan.songs} 曲
              </span>
            </div>
          )}
          {(autoDJ || autoFollow) && <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-sm text-accent">AUTO {autoDJ ? "DJ" : "FOLLOW"}</span>}
        </div>
        <button className="btn px-4 py-2 text-sm" onClick={() => useDJ.setState({ liveView: false })} title="通常画面に戻る (Tab)">
          ✕ 通常画面 (Tab)
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-5">
          <div className="label text-emerald-300">NOW · Deck {main}</div>
          <div className="mt-1 truncate text-3xl font-bold md:text-4xl">{d.track?.name ?? "—"}</div>
          <div className="mt-2 flex flex-wrap items-baseline gap-4 font-mono text-xl text-zinc-300">
            <span>{d.track?.bpm ? `${(d.track.bpm * d.rate).toFixed(1)} BPM` : ""}</span>
            <span>{d.track?.key ?? ""}</span>
            <span>
              {fmt(d.position)} <span className="text-zinc-500">/ −{fmt(Math.max(0, d.duration - d.position))}</span>
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded bg-zinc-800">
            <div className="h-full bg-emerald-400" style={{ width: `${d.duration ? (d.position / d.duration) * 100 : 0}%` }} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {mixing ? (
              <span className="animate-pulse rounded-lg bg-amber-500/20 px-4 py-2 text-2xl font-bold text-amber-200">MIXING…</span>
            ) : autoIn != null ? (
              <span className={`rounded-lg px-4 py-2 text-3xl font-black tabular-nums ${autoIn < 10 ? "bg-rose-500/20 text-rose-200" : "bg-zinc-800 text-zinc-100"}`}>切替まで {fmt(autoIn)}</span>
            ) : (
              <span className="text-zinc-500">自動切替なし</span>
            )}
            <span className="font-mono text-sm uppercase text-zinc-400">{style}</span>
          </div>
        </section>

        <section className="rounded-2xl border border-sky-500/30 bg-sky-950/20 p-5">
          <div className="label text-sky-300">NEXT · Deck {other}</div>
          <div className="mt-1 truncate text-3xl font-bold md:text-4xl">{n.track?.name ?? (autoDJ ? "選曲中…" : "—")}</div>
          <div className="mt-2 flex flex-wrap items-baseline gap-4 font-mono text-xl text-zinc-300">
            <span>{n.track?.bpm ? `${(n.track.bpm * n.rate).toFixed(1)} BPM` : ""}</span>
            <span>{n.track?.key ?? ""}</span>
            {n.keyShift ? <span className="text-amber-300">key {n.keyShift > 0 ? "+" : ""}{n.keyShift}</span> : null}
          </div>
          {upcoming.length > 0 && (
            <div className="mt-3 text-sm text-zinc-400">
              <span className="label">その後 (キュー)</span>
              <ol className="mt-1 list-decimal pl-5">
                {upcoming.map((u, i) => (
                  <li key={i} className="truncate">
                    {u}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="btn px-4 py-3 text-base"
              disabled={!autoDJ}
              onClick={() => {
                // Throw the current pick away and let Auto DJ choose again.
                useDJ.getState().setNextOverride(null);
                const idle = other;
                const { decks: ds } = useDJ.getState();
                if (!ds[idle].playing) {
                  // Marking the idle track as "spent" makes the ticker preload a fresh pick.
                  spentTracks[idle] = ds[idle].track?.id ?? null;
                  void useDJ.getState().preloadNext(main);
                }
              }}
              title="次の曲を選び直す (Auto DJ)"
            >
              ⟳ 次を選び直す
            </button>
            <button className="btn btn-primary px-4 py-3 text-base" disabled={!n.track || mixing} onClick={() => void s.autoMix()} title="待たずに今すぐ繋ぐ (M)">
              ▶ 今すぐ繋ぐ
            </button>
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="rounded-2xl border border-border bg-panel p-4">
          <div className="flex flex-col gap-2">
            <VUMeter />
            <PhraseMeter />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="font-mono text-sm">A</span>
            <input type="range" min={0} max={1} step={0.01} value={crossfader} aria-label="クロスフェーダー" className="h-4 flex-1" onChange={(e) => s.setCrossfader(parseFloat(e.target.value))} />
            <span className="font-mono text-sm">B</span>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {mixing && (
            <button className="btn btn-danger px-5 py-4 text-lg" onClick={() => s.cancelMix()}>
              ■ 中止
            </button>
          )}
          <button className="btn btn-danger px-5 py-4 text-lg" onClick={() => s.fadeOut()} title="再生中の曲をフェードアウトして停止 (緊急)">
            Fade Out
          </button>
          <button className="btn btn-primary px-5 py-4 text-lg" onClick={() => s.buildDrop(8)} title="8 小節ビルド → ドロップ (Y)">
            Build & Drop
          </button>
          <button className="btn px-5 py-4 text-lg" onClick={() => s.echoThrow()} title="エコースロー (T)">
            Echo Throw
          </button>
          <button className="btn px-5 py-4 text-lg" onClick={() => s.crowd()} title="Crowd! (U)">
            Crowd!
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="label">Look</span>
        {looks.map((l, i) => (
          <button key={l.id} className={`btn px-4 py-3 text-base ${activeLook === l.id ? "btn-accent" : ""}`} aria-pressed={activeLook === l.id} onClick={() => s.applyLook(l.id)} title={i < 10 ? `キー: ${i < 5 ? 5 + i : `Shift+${i}`}` : undefined}>
            {l.name}
          </button>
        ))}
      </div>
    </div>
  );
}
