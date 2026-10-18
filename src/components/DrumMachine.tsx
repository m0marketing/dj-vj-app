"use client";

import { useDJ } from "@/lib/store";
import { SEQ_LANES, SEQ_STEPS, type Step } from "@/lib/audio/sequencer";
import { BANK_NAMES, PADS_PER_BANK } from "@/lib/types";

/**
 * 16-step drum machine on top of the sampler: 8 lanes (any pad), 4 pattern slots, swing, accents.
 * Follows the playing deck's tempo and starts on its next bar; stand-alone it runs at its own BPM.
 */
export default function DrumMachine() {
  const seq = useDJ((s) => s.seq);
  const pads = useDJ((s) => s.pads);
  const decks = useDJ((s) => s.decks);
  const pattern = seq.patterns[seq.slot];
  const deckPlaying = decks.A.playing || decks.B.playing;
  const live = deckPlaying ? ((decks.A.playing ? decks.A : decks.B).track?.bpm ?? null) : null;
  const act = useDJ.getState();
  const cycle = (v: Step): Step => ((v + 1) % 3) as Step;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-black/20 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button className={`btn btn-primary ${seq.playing ? "animate-pulse" : ""}`} onClick={act.seqToggle} title="再生 / 停止 (P)。デッキ再生中は次の小節頭から、デッキのテンポに同期">
          {seq.playing ? "■ 停止" : "▶ 再生"}
        </button>
        <div className="flex rounded-md border border-border" role="radiogroup" aria-label="パターン">
          {[0, 1, 2, 3].map((i) => (
            <button key={i} role="radio" aria-checked={seq.slot === i} className={`px-2.5 py-1 text-xs font-bold ${seq.slot === i ? "bg-accent/20 text-accent" : "text-zinc-400 hover:text-zinc-200"}`} onClick={() => act.seqSetSlot(i)} title={`パターン ${i + 1}`}>
              {i + 1}
            </button>
          ))}
        </div>
        <span className="font-mono text-[11px] text-zinc-400">{live ? `${(live * (decks.A.playing ? decks.A : decks.B).rate).toFixed(1)} BPM (デッキに同期)` : `${seq.bpm} BPM`}</span>
        {!live && <input type="range" min={60} max={180} step={1} value={seq.bpm} className="w-24" aria-label="シーケンサーのテンポ" onChange={(e) => act.seqSetBpm(parseInt(e.target.value))} />}
        <label className="flex items-center gap-1 text-[11px] text-zinc-400">
          Swing
          <input type="range" min={0} max={0.6} step={0.01} value={seq.swing} className="w-16" aria-label="スウィング" onChange={(e) => act.seqSetSwing(parseFloat(e.target.value))} />
        </label>
        <span className="label ml-auto">Presets</span>
        {(["house", "techno", "trap", "breaks"] as const).map((n) => (
          <button key={n} className="btn py-0.5" onClick={() => act.seqPreset(n)} title={`${n} パターンと対応キットを読み込む`}>
            {n}
          </button>
        ))}
        <button className="btn py-0.5" onClick={act.seqClear} title="このパターンのステップを消す">
          クリア
        </button>
      </div>
      <div className="grid gap-1 overflow-x-auto" style={{ gridTemplateColumns: "minmax(7rem, 9rem) repeat(16, minmax(1.5rem, 1fr))" }}>
        {Array.from({ length: SEQ_LANES }, (_, lane) => {
          const pad = pattern.lanes[lane];
          const padCfg = pad != null ? pads[pad] : null;
          return (
            <div key={lane} className="contents">
              <select
                className="min-w-0 truncate rounded border border-border bg-panel px-1 py-0.5 text-[11px]"
                value={pad ?? ""}
                aria-label={`レーン ${lane + 1} のパッド`}
                style={padCfg ? { borderColor: padCfg.color } : undefined}
                onChange={(e) => act.seqSetLane(lane, e.target.value === "" ? null : parseInt(e.target.value))}
              >
                <option value="">— 空 —</option>
                {pads
                  .filter((p) => p.sampleId)
                  .map((p) => (
                    <option key={p.index} value={p.index}>
                      {BANK_NAMES[Math.floor(p.index / PADS_PER_BANK)]}
                      {(p.index % PADS_PER_BANK) + 1} · {p.name}
                    </option>
                  ))}
              </select>
              {Array.from({ length: SEQ_STEPS }, (_, st) => {
                const v = pattern.steps[lane][st];
                const now = seq.playing && seq.step === st;
                return (
                  <button
                    key={st}
                    type="button"
                    aria-label={`レーン ${lane + 1} ステップ ${st + 1}: ${v === 2 ? "アクセント" : v === 1 ? "オン" : "オフ"}`}
                    className={`h-7 min-w-6 rounded border text-[9px] transition ${st % 4 === 0 ? "border-zinc-600" : "border-zinc-800"} ${now ? "ring-1 ring-white" : ""}`}
                    style={{ background: v === 2 ? (padCfg?.color ?? "#22d3ee") : v === 1 ? `${padCfg?.color ?? "#22d3ee"}88` : st % 8 < 4 ? "#141418" : "#0f0f12" }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      act.seqSetStep(lane, st, e.button === 2 ? 0 : cycle(v));
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-zinc-500">クリックでオン → アクセント → オフ。右クリックで消去。レーンのプルダウンでどのパッドでも鳴らせます (バンク G = 909、H = 808)。デッキが鳴っていればその小節に同期します。</p>
    </div>
  );
}
