"use client";

import { useEffect, useRef, useState } from "react";
import { MODES, useDJ } from "@/lib/store";
import { VJ_SHOWS, VJ_THEMES } from "@/lib/types";
import AudioTicker from "./AudioTicker";
import ConfirmDialog from "./ConfirmDialog";
import DeckPanel from "./DeckPanel";
import DrumMachine from "./DrumMachine";
import PanelBoundary from "./PanelBoundary";
import LiveView from "./LiveView";
import MidiPanel from "./MidiPanel";
import KeyboardShortcuts from "./KeyboardShortcuts";
import Library from "./Library";
import Mixer from "./Mixer";
import SamplerPads from "./SamplerPads";
import ShortcutsOverlay from "./ShortcutsOverlay";
import StartGate from "./StartGate";
import Toast from "./Toast";
import VJPanel from "./VJPanel";

const TABS = [
  { id: "decks", label: "Decks", icon: "🎚" },
  { id: "pads", label: "Pads", icon: "🥁" },
  { id: "vj", label: "VJ", icon: "✨" },
  { id: "library", label: "Library", icon: "🎵" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/**
 * Responsive layout
 *  phone  (<768):   one section at a time, bottom tab bar; page scrolls vertically
 *  tablet (768+):   2 columns (Deck A/Mixer/Library | Deck B/Pads), VJ full width below
 *  desktop (1024+): 3 columns with the VJ panel pinned while the page scrolls
 * Panels stay mounted when hidden so audio / canvas state is preserved.
 */
export default function Studio() {
  const [tab, setTab] = useState<Tab>("decks");
  const show = (t: Tab) => (tab === t ? "block" : "hidden md:block");
  const recording = useDJ((s) => s.recording);
  const autoFollow = useDJ((s) => s.autoFollow);
  const autoDJ = useDJ((s) => s.autoDJ);
  const saveMode = useDJ((s) => s.saveMode);
  const filterFx = useDJ((s) => s.filterFx);
  const sessionAvailable = useDJ((s) => s.sessionAvailable);
  const [midiOpen, setMidiOpen] = useState(false);
  const beatRepeat = useDJ((s) => s.beatRepeat);
  const mode = useDJ((s) => s.mode);
  const theme = useDJ((s) => s.vj.theme);
  const vjShow = useDJ((s) => s.vj.show);
  // Stored in the (persisted) VJ settings so it survives reloads without an SSR/hydration mismatch.
  const layout = useDJ((s) => s.vj.layout ?? "vj");
  const seqOpen = useDJ((s) => s.seq.open);
  const drumRef = useRef<HTMLDivElement>(null);
  // The drum machine lives below the deck columns on desktop; bring it on screen when it is opened.
  useEffect(() => {
    if (seqOpen) drumRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [seqOpen]);
  const toggleLayout = () => useDJ.getState().setVJ({ layout: layout === "vj" ? "dj" : "vj" });

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1800px] flex-col gap-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))] md:pb-20">
      <StartGate />
      <AudioTicker />
      <KeyboardShortcuts />
      <Toast />
      <ConfirmDialog />
      <LiveView />
      {midiOpen && <MidiPanel onClose={() => setMidiOpen(false)} />}
      <ShortcutsOverlay />

      <header className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="shrink-0 text-sm font-bold tracking-tight">
            DJ<span className="text-accent">/</span>VJ Studio
          </h1>
          <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="演出モード">
            <span className="label" title="Mode = 曲の流し方 (演出)。見た目は右の Theme">Mode</span>
            {MODES.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={mode === m.id}
                className={`btn no-led py-1 ${mode === m.id ? "btn-accent" : ""}`}
                onClick={() => useDJ.getState().applyMode(m.id)}
                title={m.desc}
              >
                {m.icon} <span className="max-lg:hidden">{m.label}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-[11px] text-zinc-400" title="Theme = VJ の見た目 (Mode とは独立)">
            <span className="label">Theme</span>
            <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={theme} aria-label="VJ テーマ" onChange={(e) => useDJ.getState().applyTheme(e.target.value as "free")}>
              {VJ_THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[11px] text-zinc-400" title="演出 = VJ の動き方 (カメラ・カット・派手さ)。Theme と自由に組み合わせ">
            <span className="label">演出</span>
            <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={vjShow} aria-label="VJ の演出スタイル" onChange={(e) => useDJ.getState().applyShow(e.target.value as "club")}>
              {VJ_SHOWS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <form action="/api/auth/logout" method="post">
            <button className="btn" type="submit" title="このブラウザの音源と設定を残してログアウト">ログアウト</button>
          </form>
          {(autoFollow || autoDJ) && (
            <button
              className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-accent hover:bg-accent/20"
              title={autoDJ ? "Auto DJ が有効: 曲を自動で選んで繋ぎ続けます。クリックで OFF" : "Auto Follow が有効: 止まっているデッキに曲をセットすると、再生中の曲の終わりで自動ミックス。クリックで OFF"}
              onClick={() => (autoDJ ? useDJ.getState().setAutoDJ(false) : useDJ.getState().setAutoFollow(false))}
            >
              AUTO {autoDJ ? "DJ" : "FOLLOW"} ON ✕
            </button>
          )}
          {sessionAvailable && (
            <span className="flex items-center overflow-hidden rounded-full border border-emerald-400/60 bg-emerald-500/15 text-emerald-200">
              <button className="px-2 py-0.5 hover:bg-emerald-500/20" onClick={() => void useDJ.getState().restoreSession()} title="前回のデッキ・位置・Auto DJ・プランを復元して再開">
                ↻ 前回の続きから再開
              </button>
              <button className="px-1.5 py-0.5 text-emerald-300/70 hover:bg-emerald-500/20" onClick={() => useDJ.setState({ sessionAvailable: null })} aria-label="前回のセッションを無視">
                ✕
              </button>
            </span>
          )}
          {(filterFx || beatRepeat != null) && (
            <button
              className="animate-pulse rounded-full border border-rose-400/60 bg-rose-500/15 px-2 py-0.5 text-rose-200"
              onClick={() => {
                if (filterFx) useDJ.getState().setFilterFx(null);
                if (beatRepeat != null) useDJ.getState().setBeatRepeat(null);
              }}
              title="マスターにフィルター / ビートリピートがかかったままです (タップでラッチされた状態)。クリックで解除 (Esc でも)"
            >
              ⚠ {filterFx ? (filterFx === "lpf" ? "LPF" : "HPF") : "REPEAT"} ON — 解除
            </button>
          )}
          {saveMode === "temp" && (
            <button className="rounded-full border border-amber-400/60 bg-amber-500/15 px-2 py-0.5 text-amber-300" onClick={() => useDJ.getState().setSaveMode("persist")} title="一時モード: 追加した曲・サンプルはリロードで消えます。クリックで継続保存に戻す">
              一時モード (クリックで継続に戻す)
            </button>
          )}
          <button className="btn max-lg:hidden" onClick={toggleLayout} title="PC での画面配分を切替" aria-label="画面配分の切替">
            {layout === "vj" ? "⊞ VJ 大" : "⊞ DJ 大"}
          </button>
          {recording && <span className="animate-pulse rounded-full border border-rose-500/50 bg-rose-500/10 px-2 py-0.5 text-rose-300">● REC</span>}
          <button className="btn" onClick={() => setMidiOpen(true)} title="MIDI コントローラーの割り当て (MIDI ラーン)">
            🎹 MIDI
          </button>
          <button className="btn btn-primary" onClick={() => useDJ.setState({ liveView: true })} title="本番モード: 今の曲 / 次の曲 / 切替までの秒数 / 中止・フェードアウト・盛り上げ を大きく表示 (Tab)">
            ▶ 本番
          </button>
          <button className="btn" onClick={() => useDJ.getState().openHelp("start")} title="使い方ガイドとキーボードショートカット (?)" aria-label="ヘルプ">
            ? <span className="max-sm:hidden">ヘルプ</span>
          </button>
        </div>
      </header>

      <div className={`grid gap-3 max-md:contents md:grid-cols-2 ${layout === "vj" ? "lg:grid-cols-[1fr_1fr_1.25fr] xl:grid-cols-[1fr_1fr_1.55fr] 2xl:grid-cols-[1fr_1fr_1.7fr]" : "lg:grid-cols-[1fr_1fr_minmax(300px,0.9fr)]"}`}>
        <div className="flex min-w-0 flex-col gap-3 max-md:contents">
          <div className={show("decks")}>
            <PanelBoundary name="Deck A">
              <DeckPanel id="A" />
            </PanelBoundary>
          </div>
          <div className={show("decks")}>
            <PanelBoundary name="Mixer">
              <Mixer />
            </PanelBoundary>
          </div>
          <div className={show("library")}>
            <PanelBoundary name="Library">
              <Library />
            </PanelBoundary>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3 max-md:contents">
          <div className={show("decks")}>
            <PanelBoundary name="Deck B">
              <DeckPanel id="B" />
            </PanelBoundary>
          </div>
          <div className={show("pads")}>
            <PanelBoundary name="Sampler">
              <SamplerPads />
            </PanelBoundary>
          </div>
        </div>
        {seqOpen && (
          <div ref={drumRef} className={`${show("pads")} panel max-md:hidden md:col-span-2 lg:col-start-1 lg:col-end-3 lg:row-start-2 p-3`}>
            <DrumMachine />
          </div>
        )}
        <div className={`${show("vj")} min-w-0 md:col-span-2 lg:sticky lg:top-3 lg:col-span-1 lg:col-start-3 lg:row-start-1 lg:row-span-2 lg:max-h-[calc(100dvh-1.5rem)] lg:self-start lg:overflow-y-auto lg:rounded-xl`}>
          <PanelBoundary name="VJ">
            <VJPanel />
          </PanelBoundary>
        </div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-panel/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="セクション切替"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition active:scale-95 ${tab === t.id ? "text-accent" : "text-zinc-500"}`}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => {
              setTab(t.id);
              window.scrollTo({ top: 0 });
            }}
          >
            <span className="text-lg leading-none" aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </nav>
    </main>
  );
}
