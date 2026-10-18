"use client";

import { useRef, useState } from "react";
import { autoTarget, beatsFor, effectiveStyle, leadMs, nextDropAfter, snapToPhrase, useDJ } from "@/lib/store";
import { useLongPress } from "@/lib/useLongPress";
import type { DeckId } from "@/lib/types";
import Waveform from "./Waveform";
import HelpButton from "./HelpButton";
import ZoomWave from "./ZoomWave";
import Platter from "./Platter";

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const DECK_COLOR: Record<DeckId, string> = { A: "#22d3ee", B: "#f472b6" };
const CUE_COLORS = ["#f43f5e", "#f97316", "#eab308", "#a855f7"];

export default function DeckPanel({ id }: { id: DeckId }) {
  const deck = useDJ((s) => s.decks[id]);
  const otherDeck = useDJ((s) => s.decks[id === "A" ? "B" : "A"]);
  const act = useDJ((s) => s.deckAction);
  const mixOut = useDJ((s) => s.mixOut[id]);
  const meta = useDJ((s) => s.tracks.find((t) => t.id === deck.track?.id));
  const autoFollow = useDJ((s) => s.autoFollow);
  const autoDJ = useDJ((s) => s.autoDJ);
  const autoStyle = useDJ((s) => s.autoStyle);
  const plannedStyle = useDJ((s) => s.plannedStyle);
  const djSegment = useDJ((s) => s.djSegment);
  const mixBeats = useDJ((s) => s.mixBeats);
  const setMixOut = useDJ((s) => s.setMixOut);
  const syncToOther = useDJ((s) => s.syncToOther);
  const color = DECK_COLOR[id];
  const bpm = deck.track?.bpm ? Math.round(deck.track.bpm * deck.rate * 10) / 10 : null;
  const remaining = Math.max(0, deck.duration - deck.position);
  const ending = deck.playing && deck.duration > 0 && remaining < 30;
  const bpmForLoop = deck.track?.bpm;
  const loopArmed = deck.loop.in != null && deck.loop.out == null;
  const beatLoopOn = (b: number) => deck.loop.active && deck.loop.in != null && deck.loop.out != null && !!bpmForLoop && Math.abs(deck.loop.out - deck.loop.in - (60 / bpmForLoop) * b) < 0.03;
  const chorusList: [number, number][] = meta?.choruses?.length ? meta.choruses : meta?.chorusStart != null && meta.chorusEnd != null ? [[meta.chorusStart, meta.chorusEnd]] : [];
  const [bpmEdit, setBpmEdit] = useState(false);
  const [chorusEdit, setChorusEdit] = useState(false);
  const cue = useDJ((s) => s.cue);
  const vinyl = useDJ((s) => s.vinyl[id]);
  const [confirmLoad, setConfirmLoad] = useState<string | null>(null);

  // Countdown to the automatic transition (Auto Follow / Auto DJ) from this deck.
  let autoIn: number | null = null;
  if ((autoFollow || autoDJ) && deck.playing && !otherDeck.playing && deck.duration) {
    let rawTarget = autoDJ ? autoTarget(id, mixOut, deck.duration, djSegment, deck.track?.soundEnd, deck.track?.chorusEnd) : Math.min(mixOut ?? deck.duration, deck.track?.soundEnd ?? deck.duration);
    const bpmNow = (deck.track?.bpm ?? 120) * deck.rate;
    const style = effectiveStyle(autoStyle, plannedStyle);
    if (style === "doubledrop") {
      const drop = nextDropAfter(deck.track, deck.position + (4 * 60) / bpmNow);
      if (drop != null) rawTarget = drop;
    }
    const lead = leadMs(style, autoDJ ? beatsFor(djSegment, mixBeats) : mixBeats, bpmNow) / 1000 + (4 * 60) / bpmNow;
    const target = mixOut != null || style === "doubledrop" ? rawTarget : snapToPhrase(rawTarget, deck.track, deck.position, deck.rate, lead, djSegment);
    const ready = autoDJ || !!otherDeck.track;
    if (ready) autoIn = Math.max(0, (target - deck.position) / deck.rate - lead);
  }

  return (
    <div
      className="panel flex flex-col gap-2 p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const trackId = e.dataTransfer.getData("track-id");
        if (!trackId) return;
        if (deck.playing) setConfirmLoad(trackId);
        else void useDJ.getState().loadToDeck(trackId, id);
      }}
    >
      {/* LCD display */}
      <div className="relative flex items-center gap-3 rounded-lg border border-border bg-black/60 px-3 py-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-base font-black text-black" style={{ background: color }}>
          {id}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight">{deck.track?.name ?? "NO TRACK"}</div>
          <div className="flex items-center gap-3 font-mono text-[11px] text-zinc-400">
            <span className="text-zinc-100">{fmt(deck.position)}</span>
            <span className={ending ? "animate-pulse font-bold text-rose-400" : ""}>-{fmt(remaining)}</span>
            <span className={deck.loop.active ? "text-emerald-400" : "text-zinc-600"}>LOOP</span>
            {autoIn != null && (
              <span className="max-w-[16rem] truncate rounded bg-accent/15 px-1 text-accent" title="Auto Follow / Auto DJ が自動ミックスを開始するまで">
                AUTO MIX {fmt(autoIn)}
                {otherDeck.track && !otherDeck.playing ? ` ▸ ${otherDeck.track.name}` : ""}
                {plannedStyle ? ` (${plannedStyle})` : ""}
              </span>
            )}
          </div>
        </div>
        <button
          className="rounded-md px-1 text-right transition hover:bg-white/5"
          disabled={!deck.track}
          onClick={() => setBpmEdit((v) => !v)}
          title="BPM / ビートグリッドを編集"
          aria-label="BPM とビートグリッドを編集"
        >
          <div className="font-mono text-2xl font-bold leading-none" style={{ color }}>
            {bpm ? bpm.toFixed(1) : deck.track ? "…" : "---.-"}
          </div>
          <div className="label">
            {meta?.key ? `${meta.key} · ` : ""}BPM{deck.rate !== 1 && <span className="ml-1 text-zinc-300">{deck.rate > 1 ? "+" : ""}{((deck.rate - 1) * 100).toFixed(1)}%</span>}
          </div>
        </button>
        <button className="btn" disabled={!deck.track} onClick={() => act(id, (d) => d.eject())} aria-label="トラックを取り出す" title="取り出す">
          ⏏
        </button>
        <HelpButton section="deck" />
        {bpmEdit && deck.track && <BpmEditor key={deck.track.id} id={id} onClose={() => setBpmEdit(false)} />}
        {confirmLoad && (
          <div className="absolute inset-0 z-10 flex items-center justify-between gap-2 rounded-lg border border-rose-500/50 bg-black/95 px-3 text-xs">
            <span>Deck {id} は再生中です。曲を差し替えますか？</span>
            <div className="flex gap-1">
              <button className="btn" onClick={() => setConfirmLoad(null)}>
                やめる
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  void useDJ.getState().loadToDeck(confirmLoad, id, true);
                  setConfirmLoad(null);
                }}
              >
                差し替える
              </button>
            </div>
          </div>
        )}
      </div>

      <ZoomWave deck={id} trackId={deck.track?.id ?? null} color={color} onSeek={(t) => act(id, (d) => d.seek(t))} />
      <Waveform
        deck={id}
        trackId={deck.track?.id ?? null}
        vocal={meta?.vocalMap && meta.bpm ? { map: meta.vocalMap, bpm: meta.bpm, beatOffset: meta.beatOffset ?? 0 } : null}
        position={deck.position}
        duration={deck.duration}
        cues={deck.cues}
        cuePoint={deck.cuePoint}
        mark={mixOut}
        chorus={meta?.choruses?.length ? meta.choruses : meta?.chorusStart != null && meta.chorusEnd != null ? [[meta.chorusStart, meta.chorusEnd]] : null}
        loop={deck.loop}
        color={color}
        onSeek={(t) => act(id, (d) => d.seek(t))}
        onMarkChorus={(a, b) => {
          const t = deck.track;
          if (!t) return;
          const barSec = t.bpm ? 240 / t.bpm : 2;
          const bars = Math.max(4, Math.round((b - a) / barSec));
          void useDJ.getState().setChorus(t.id, a, bars);
        }}
        onMarkOut={(t) => useDJ.getState().setMixOut(id, t)}
      />

      {/* Platter + transport */}
      <div className="grid grid-cols-[minmax(110px,38%)_1fr] items-center gap-3">
        <Platter deck={id} color={color} vinyl={vinyl} onNudge={(dt) => act(id, (d) => d.seek(d.position + dt))} onBendEnd={() => useDJ.getState().syncDecks()} />
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              className="touch-none rounded-xl border-2 py-4 text-base font-black tracking-widest transition active:scale-95 disabled:opacity-40"
              style={{ borderColor: "#f97316", color: "#f97316", background: "rgba(249,115,22,0.12)" }}
              disabled={!deck.track}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                act(id, (d) => d.cuePress());
              }}
              onPointerUp={() => act(id, (d) => d.cueRelease())}
              onPointerCancel={() => act(id, (d) => d.cueRelease())}
              title="再生中: キューポイントへ戻って停止 / 停止中: ここをキューに設定 / キュー上で押し続ける: 試聴"
            >
              CUE
            </button>
            <button
              className="rounded-xl border-2 py-4 text-base font-black tracking-widest transition active:scale-95 disabled:opacity-40"
              style={{
                borderColor: color,
                color: deck.playing ? "#000" : color,
                background: deck.playing ? color : `${color}20`,
                boxShadow: deck.playing ? `0 0 24px ${color}80` : undefined,
              }}
              disabled={!deck.track}
              onClick={() =>
                act(id, (d) => {
                  const st = useDJ.getState();
                  const quietSet = !st.decks.A.playing && !st.decks.B.playing;
                  const atStart = d.position <= (d.track?.soundStart ?? 0) + 0.5;
                  // Opening the set from the top of a track: fade in over 2 bars instead of slamming it.
                  if (!d.playing && quietSet && atStart && st.softStart) d.playFadeIn(Math.min(8, (8 * 60) / (d.track?.bpm ?? 120)));
                  else d.togglePlay();
                })
              }
              aria-label={deck.playing ? "一時停止" : "再生"}
            >
              {deck.playing ? "❚❚" : "▶"}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <button className="btn" disabled={!deck.track} onClick={() => act(id, (d) => d.seek(d.position - 5))} aria-label="5 秒戻る">
              ◀◀ 5s
            </button>
            <button className="btn" disabled={!deck.track} onClick={() => act(id, (d) => d.seek(d.position + 5))} aria-label="5 秒進む">
              5s ▶▶
            </button>
            <button className="btn btn-primary" disabled={!deck.track?.bpm || !otherDeck.track?.bpm} onClick={() => syncToOther(id)} title="相手デッキの BPM に合わせ、相手が再生中ならビートの位相も揃える">
              SYNC
            </button>
          </div>
        </div>
      </div>

      {/* Hot cues */}
      <div className="grid grid-cols-4 gap-1.5">
        {deck.cues.map((c, i) => (
          <HotCue key={i} index={i} value={c} disabled={!deck.track} onTap={() => act(id, (d) => d.jumpCue(i))} onClear={() => act(id, (d) => d.clearCue(i))} />
        ))}
      </div>

      {/* Chorus (サビ) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="label w-8">サビ</span>
        <button
          className="btn flex-1 whitespace-nowrap text-amber-300 disabled:text-zinc-500"
          disabled={!chorusList.length}
          onClick={() => {
            // Jump to the next chorus after the playhead (wraps to the first).
            const next = chorusList.find(([a]) => a > deck.position + 1) ?? chorusList[0];
            act(id, (d) => d.seek(next[0]));
          }}
          title={chorusList.length > 1 ? "次のサビへジャンプ (複数あり)" : "検出 / 設定したサビの頭へジャンプ"}
        >
          ▶ サビへ{" "}
          {chorusList.length ? (
            <span className="font-mono text-[10px] opacity-70">
              {chorusList.length > 1 ? `×${chorusList.length} · ` : ""}
              {fmt(chorusList[0][0])}–{fmt(chorusList[0][1])}
              {chorusList.length > 1 ? " …" : ""}
            </span>
          ) : (
            <span className="text-[10px] opacity-60">未検出</span>
          )}
        </button>
        <button className={`btn ${chorusEdit ? "btn-accent" : ""}`} aria-expanded={chorusEdit} disabled={!deck.track} onClick={() => setChorusEdit((v) => !v)} title="サビの位置を手で直す / 再検出" aria-label="サビの編集">
          ✎
        </button>
        {chorusEdit && (
          <>
            <button className="btn whitespace-nowrap" disabled={!deck.track} onClick={() => void useDJ.getState().setChorus(deck.track!.id, deck.position, 16)} title="今の再生位置 (小節頭に吸着) からサビとして 16 小節を設定">
              ここをサビに
            </button>
            <button className="btn" disabled={!deck.track} onClick={() => void useDJ.getState().setChorus(deck.track!.id, deck.position, 8)} title="8 小節版" aria-label="ここから 8 小節をサビに">
              8
            </button>
            <button className="btn" disabled={!deck.track} onClick={() => void useDJ.getState().setChorus(deck.track!.id, deck.position, 32)} title="32 小節版" aria-label="ここから 32 小節をサビに">
              32
            </button>
            <button className="btn" disabled={!deck.track?.bpm} onClick={() => void useDJ.getState().detectChorusFor(deck.track!.id)} title="サビを自動で再検出 (手動設定は上書きされます)" aria-label="サビを自動検出">
              ⟲ 自動
            </button>
          </>
        )}
      </div>

      {/* Scratch */}
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <button
          className={`btn py-1 ${vinyl ? "btn-accent" : ""}`}
          aria-pressed={vinyl}
          onClick={() => useDJ.getState().setVinyl(id, !vinyl)}
          title="VINYL モード: 再生中にジョグを回すとスクラッチ (逆回転も)。離した位置から再生が続く。OFF だとジョグはテンポのナッジ"
        >
          VINYL
        </button>
        <span className="label">Scratch</span>
        {(
          [
            ["baby", "Baby", "前後に 1 拍ずつ往復 (2 拍)"],
            ["chirp", "Chirp", "フェーダーを開閉しながら短く往復"],
            ["transformer", "Transf", "ゆっくり引きながらフェーダーをカチカチ (1/8 拍)"],
            ["scribble", "Scribble", "細かく速い往復 (1 拍)"],
            ["stab", "Stab", "強く押し出して止め、ゆっくり戻す"],
            ["rewind", "Rewind", "逆回転で加速 (巻き戻し)。戻した位置から再生"],
          ] as const
        ).map(([k, label, hint]) => (
          <button key={k} className="btn py-1" disabled={!deck.playing && !deck.scratching} onClick={() => useDJ.getState().scratch(id, k)} title={`${hint}。次の拍から開始し、終わると拍に合わせて元の流れに戻る`}>
            {label}
          </button>
        ))}
      </div>

      {/* Loops */}
      <div className="flex flex-wrap gap-1.5">
        <button
          className={`btn flex-1 whitespace-nowrap ${loopArmed ? "btn-accent" : ""}`}
          aria-pressed={loopArmed}
          disabled={!deck.track}
          onClick={() => act(id, (d) => (loopArmed ? d.clearLoop() : d.setLoopIn()))}
          title={loopArmed ? "ループ開始点を設定済み。もう一度押すと取り消し" : "現在位置をループの開始点にする"}
        >
          Loop In
        </button>
        <button className="btn flex-1 whitespace-nowrap" disabled={!deck.track || deck.loop.in == null} onClick={() => act(id, (d) => d.setLoopOut())}>
          Loop Out
        </button>
        {[1, 2, 4, 8].map((b) => {
          const on = beatLoopOn(b);
          return (
            <button
              key={b}
              className={`btn no-led ${on ? "btn-accent" : ""}`}
              aria-pressed={on}
              disabled={!deck.track}
              onClick={() => act(id, (d) => (on ? d.toggleLoop() : d.setBeatLoop(b, deck.track?.bpm ?? null)))}
              title={on ? `${b} 拍ループ中。もう一度押すと解除` : `${b} 拍ループ (ビートグリッドに吸着)`}
              aria-label={`${b} 拍ループ`}
            >
              {b}
            </button>
          );
        })}
        <button className="btn" disabled={deck.loop.in == null || deck.loop.out == null} onClick={() => act(id, (d) => d.scaleLoop(0.5))} title="ループを半分に" aria-label="ループを半分に">
          ½
        </button>
        <button className="btn" disabled={deck.loop.in == null || deck.loop.out == null} onClick={() => act(id, (d) => d.scaleLoop(2))} title="ループを 2 倍に" aria-label="ループを 2 倍に">
          ×2
        </button>
        <button
          className={`btn no-led ${deck.loop.active ? "btn-accent" : ""}`}
          disabled={!deck.track || deck.loop.in == null || deck.loop.out == null}
          onClick={() => act(id, (d) => d.toggleLoop())}
          aria-pressed={deck.loop.active}
          aria-label="ループ ON/OFF"
          title="ループ ON/OFF"
        >
          ⟳
        </button>
        <button
          className={`btn whitespace-nowrap ${mixOut != null ? "btn-accent" : ""}`}
          aria-pressed={mixOut != null}
          disabled={!deck.track}
          onClick={() => setMixOut(id, mixOut == null ? deck.position : null)}
          title="現在位置を「ミックスアウト位置(曲の終わり)」に指定。もう一度押すと解除。未設定なら曲の最後まで"
        >
          {mixOut != null ? `OUT ${fmt(mixOut)} ✕` : "OUT"}
        </button>
      </div>

      {/* Pitch */}
      <div className="flex items-center gap-2">
        <ResetLabel label="Pitch" onReset={() => act(id, (d) => d.setRate(1))} className="w-12" />
        <input
          type="range"
          min={0.5}
          max={1.5}
          step={0.001}
          value={deck.rate}
          className="flex-1"
          aria-label="ピッチ"
          onChange={(e) => act(id, (d) => d.setRate(parseFloat(e.target.value)))}
          onDoubleClick={() => act(id, (d) => d.setRate(1))}
        />
        <span className="w-14 text-right font-mono text-xs text-zinc-300">
          {deck.rate > 1 ? "+" : ""}
          {((deck.rate - 1) * 100).toFixed(1)}%
        </span>
        <button
          className={`btn py-1 ${deck.keylock ? "btn-accent" : ""}`}
          aria-pressed={deck.keylock}
          onClick={() => useDJ.getState().setKeylock(id, !deck.keylock)}
          title="キーロック (マスターテンポ): テンポを変えても音程を保つ。OFF にするとレコードのように音程も変わる"
        >
          Key
        </button>
        <button className="btn py-1" disabled={!deck.track} onClick={() => useDJ.getState().setKeyShift(id, deck.keyShift - 1)} title="キーを半音下げる" aria-label="キーを半音下げる">
          ♭
        </button>
        <button
          className={`btn py-1 font-mono ${deck.keyShift ? "btn-accent" : ""}`}
          disabled={!deck.track}
          onClick={() => useDJ.getState().setKeyShift(id, 0)}
          title="キーシフト (半音)。クリックで 0 に戻す。Auto DJ はキーが合わない曲を自動で ±1〜2 半音動かします"
          aria-label="キーシフトをリセット"
        >
          {deck.keyShift > 0 ? `+${deck.keyShift}` : deck.keyShift}
        </button>
        <button className="btn py-1" disabled={!deck.track} onClick={() => useDJ.getState().setKeyShift(id, deck.keyShift + 1)} title="キーを半音上げる" aria-label="キーを半音上げる">
          ♯
        </button>
        {cue.supported && (
          <button
            className={`btn py-1 ${cue.on[id] ? "btn-accent" : ""}`}
            aria-pressed={cue.on[id]}
            onClick={() => useDJ.getState().toggleCue(id)}
            title={cue.deviceId ? "ヘッドホンで聴く (フェーダー前。会場には出ません)" : "ヘッドホン出力が未設定です (Mixer › 🎧 ヘッドホン で出力先を選択)"}
            aria-label={`Deck ${id} をヘッドホンで聴く`}
          >
            🎧
          </button>
        )}
      </div>

      {/* EQ + Filter + Volume */}
      <div className="grid grid-cols-5 gap-2 pt-1">
        {(["high", "mid", "low"] as const).map((band) => (
          <div key={band} className="flex flex-col items-center gap-1">
            <input
              type="range"
              className="vertical h-24"
              min={-24}
              max={12}
              step={0.5}
              value={deck.eq[band]}
              aria-label={`EQ ${band}`}
              onChange={(e) => act(id, (d) => d.setEQ(band, parseFloat(e.target.value)))}
              onDoubleClick={() => act(id, (d) => d.setEQ(band, 0))}
            />
            <ResetLabel label={band} onReset={() => act(id, (d) => d.setEQ(band, 0))} />
          </div>
        ))}
        <div className="flex flex-col items-center gap-1">
          <input
            type="range"
            className="vertical h-24"
            min={-1}
            max={1}
            step={0.01}
            value={deck.filter}
            aria-label="フィルター (左: ローパス / 右: ハイパス)"
            onChange={(e) => act(id, (d) => d.setFilter(parseFloat(e.target.value)))}
            onDoubleClick={() => act(id, (d) => d.setFilter(0))}
          />
          <ResetLabel label="Filter" onReset={() => act(id, (d) => d.setFilter(0))} />
        </div>
        <div className="flex flex-col items-center gap-1">
          <input type="range" className="vertical h-24" min={0} max={1} step={0.01} value={deck.volume} aria-label="チャンネルボリューム" onChange={(e) => act(id, (d) => d.setVolume(parseFloat(e.target.value)))} />
          <ResetLabel label="Vol" onReset={() => act(id, (d) => d.setVolume(1))} />
        </div>
      </div>
    </div>
  );
}

/** Caption under a fader; tapping it resets the control (touch has no double-click). */
function ResetLabel({ label, onReset, className = "" }: { label: string; onReset: () => void; className?: string }) {
  return (
    <button type="button" className={`label rounded px-1 hover:bg-white/10 hover:text-zinc-300 ${className}`} onClick={onReset} title={`${label} をリセット`}>
      {label}
    </button>
  );
}

function HotCue({ index, value, disabled, onTap, onClear }: { index: number; value: number | null; disabled: boolean; onTap: () => void; onClear: () => void }) {
  const handlers = useLongPress(onTap, () => value != null && onClear());
  return (
    <div className="relative">
      <button
        className="btn relative w-full touch-none py-1.5"
        style={value != null ? { borderColor: CUE_COLORS[index], color: CUE_COLORS[index] } : undefined}
        disabled={disabled}
        {...handlers}
        title={value != null ? "タップ: ジャンプ / 右上の ✕・長押し・右クリック: 削除" : "タップ: ここにホットキューを設定"}
      >
        HOT {index + 1}
        {value != null && <span className="ml-1 font-mono text-[9px] opacity-70">{fmt(value)}</span>}
      </button>
      {value != null && (
        <button
          type="button"
          className="absolute -right-1 -top-1 z-10 grid h-4 w-4 place-items-center rounded-full border border-border bg-panel text-[9px] leading-none text-zinc-300 hover:bg-rose-500/30 hover:text-rose-200"
          aria-label={`ホットキュー ${index + 1} を削除`}
          onClick={onClear}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** Popover: BPM ×2 / ÷2 / tap / type-in, and beat-grid alignment. */
function BpmEditor({ id, onClose }: { id: DeckId; onClose: () => void }) {
  const deck = useDJ((s) => s.decks[id]);
  const setTrackBpm = useDJ((s) => s.setTrackBpm);
  const setTrackBeatOffset = useDJ((s) => s.setTrackBeatOffset);
  const track = deck.track!;
  // While the field is focused the user's text wins; otherwise it mirrors the stored BPM (TAP / ×2 / ÷2 update it).
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const taps = useRef<number[]>([]);
  const beat = track.bpm ? 60 / track.bpm : 0;
  const tap = () => {
    const now = performance.now();
    const t = taps.current;
    if (t.length && now - t[t.length - 1] > 2500) t.length = 0;
    t.push(now);
    if (t.length > 12) t.shift();
    if (t.length >= 4) {
      const iv = (t[t.length - 1] - t[0]) / (t.length - 1);
      void setTrackBpm(track.id, Math.round((60000 / iv) * 10) / 10);
    }
  };
  return (
    <div className="absolute right-0 top-full z-20 mt-1 flex w-72 flex-col gap-2 rounded-lg border border-border bg-panel p-3 text-xs shadow-xl" onDragOver={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">BPM / ビートグリッド</span>
        <button className="btn" onClick={onClose} aria-label="閉じる">
          ✕
        </button>
      </div>
      <div className="flex gap-1">
        <input
          className="min-w-0 flex-1 rounded border border-border bg-panel-2 px-2 py-1 font-mono"
          inputMode="decimal"
          value={focused ? text : (track.bpm?.toString() ?? "")}
          onFocus={() => {
            setText(track.bpm?.toString() ?? "");
            setFocused(true);
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            setFocused(false);
            const v = parseFloat(text);
            if (v > 0 && v !== track.bpm) void setTrackBpm(track.id, v);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          aria-label="BPM"
        />
        <button className="btn" disabled={!track.bpm} onClick={() => void setTrackBpm(track.id, track.bpm! / 2)} aria-label="BPM を半分に">
          /2
        </button>
        <button className="btn" disabled={!track.bpm} onClick={() => void setTrackBpm(track.id, track.bpm! * 2)}>
          ×2
        </button>
        <button className="btn btn-primary" onClick={tap} title="拍に合わせて 4 回以上タップ">
          TAP
        </button>
        <button className="btn" onClick={() => void useDJ.getState().reanalyzeBpm(track.id)} title="BPM と 1 拍目を解析し直す (新しい検出器で)" aria-label="BPM を再解析">
          ⟲ 再解析
        </button>
      </div>
      <div className="label">グリッド (1 拍目: {(track.beatOffset ?? 0).toFixed(3)}s)</div>
      <div className="flex gap-1">
        <button className="btn flex-1" disabled={!track.bpm} onClick={() => void setTrackBeatOffset(track.id, deck.position % beat)} title="今の再生位置を拍の頭にする">
          ここを拍頭に
        </button>
        <button className="btn" disabled={!track.bpm} onClick={() => void setTrackBeatOffset(track.id, (track.beatOffset ?? 0) - 0.01)} aria-label="グリッドを 10ms 前へ">
          ◀ 10ms
        </button>
        <button className="btn" disabled={!track.bpm} onClick={() => void setTrackBeatOffset(track.id, (track.beatOffset ?? 0) + 0.01)} aria-label="グリッドを 10ms 後へ">
          10ms ▶
        </button>
      </div>
      <p className="text-[10px] leading-relaxed text-zinc-500">自動解析は半分 / 倍を間違えることがあります。ズーム波形の縦線 (太線 = 小節頭) がキックに乗るように調整してください。</p>
    </div>
  );
}
