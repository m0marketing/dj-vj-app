"use client";

import { useEffect, useState } from "react";
import { useDJ } from "@/lib/store";
import { BANK_NAMES, PAD_BANKS, PAD_COLORS, PAD_KEYS, PADS_PER_BANK, VJ_FX, type PadMode, type VJFxId } from "@/lib/types";
import HoldButton from "./HoldButton";
import PadWave from "./PadWave";
import DrumMachine from "./DrumMachine";
import HelpButton from "./HelpButton";

const MODES: { id: PadMode; label: string; hint: string }[] = [
  { id: "oneshot", label: "One-shot", hint: "押すと最後まで再生" },
  { id: "gate", label: "Gate", hint: "押している間だけ再生" },
  { id: "loop", label: "Loop", hint: "押している間ループ" },
  { id: "toggle", label: "Toggle", hint: "押すたびにループON/OFF" },
];

export default function SamplerPads() {
  const allPads = useDJ((s) => s.pads);
  const bank = useDJ((s) => s.bank);
  const setBank = useDJ((s) => s.setBank);
  const pads = allPads.slice(bank * PADS_PER_BANK, (bank + 1) * PADS_PER_BANK);
  const samples = useDJ((s) => s.samples);
  const activePads = useDJ((s) => s.activePads);
  const quantize = useDJ((s) => s.quantize);
  const keyShift = useDJ((s) => s.keyShift);
  const autoMatch = useDJ((s) => s.autoMatch);
  const micRecording = useDJ((s) => s.micRecording);
  const micSince = useDJ((s) => s.micSince);
  const echo = useDJ((s) => s.echo);
  const seqOpen = useDJ((s) => s.seq.open);
  const seqPlaying = useDJ((s) => s.seq.playing);
  const playingCount = activePads.length;
  const { pressPad, releasePad, updatePad, assignSample, importSamples } = useDJ.getState();
  const [editing, setEditing] = useState<number | null>(null);
  const [showSync, setShowSync] = useState(false);
  const [now, setNow] = useState(0);
  const edit = editing != null ? allPads[editing] : null;
  useEffect(() => {
    if (!micRecording) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [micRecording]);

  return (
    <div className="panel flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="label">Sampler</span>
          <HelpButton section="sampler" />
          <div className="flex min-w-0 flex-wrap rounded-md border border-border" role="tablist" aria-label="パッドバンク">
            {Array.from({ length: PAD_BANKS }, (_, b) => {
              const used = allPads.slice(b * PADS_PER_BANK, (b + 1) * PADS_PER_BANK).filter((p) => p.sampleId || p.speech).length;
              return (
                <button
                  key={b}
                  role="tab"
                  aria-selected={bank === b}
                  aria-label={`バンク ${BANK_NAMES[b]}`}
                  className={`px-2 py-1 text-xs font-bold ${bank === b ? "bg-accent/20 text-accent" : "text-zinc-400 hover:text-zinc-200"}`}
                  onClick={() => setBank(b)}
                  title={`バンク ${BANK_NAMES[b]} (F${b + 1}) · ${used}/16 使用中`}
                >
                  {BANK_NAMES[b]}
                  <span className="ml-0.5 font-mono text-[9px] opacity-60 max-xl:hidden">{used}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            className={`btn ${micRecording ? "btn-danger" : ""}`}
            onClick={() => void useDJ.getState().toggleMicRecording()}
            title={micRecording ? "録音を止めてサンプル化 (空きパッドに割り当て)" : "マイクから録音 (もう一度押して停止)"}
            aria-pressed={micRecording}
          >
            {micRecording ? `■ ${(Math.max(0, now - micSince) / 1000).toFixed(1)}s` : "🎙 録音"}
          </button>
          <HoldButton on={echo} onChange={(on) => useDJ.getState().setEcho(on)} label="Echo" title="サンプラーにエコーをかける (`)" />
          <button className={`btn ${playingCount ? "btn-danger" : ""}`} onClick={() => useDJ.getState().stopAll()} title="鳴っているサンプル / ループを全て止めて VJ 演出もクリア (Esc)">
            ■ 全停止{playingCount ? ` (${playingCount})` : ""}
          </button>
          <button className={`btn ${seqOpen ? "btn-accent" : ""}`} aria-expanded={seqOpen} onClick={() => useDJ.getState().seqSetOpen(!seqOpen)} title="16 ステップのドラムマシン (909 / 808 キット、デッキに同期)">
            🥁 Drum{seqPlaying ? " ●" : ""}
          </button>
          <button className={`btn ${showSync ? "btn-accent" : ""}`} onClick={() => setShowSync((v) => !v)} aria-expanded={showSync} title="ループのテンポ / キー同期の設定">
            ♪ Sync{keyShift ? ` (${keyShift > 0 ? "+" : ""}${keyShift})` : ""}
          </button>
          <button className={`btn ${editing != null ? "btn-accent" : ""}`} onClick={() => setEditing(editing == null ? bank * PADS_PER_BANK : null)} aria-pressed={editing != null}>
            {editing != null ? "完了" : "編集"}
          </button>
        </div>
      </div>

      {seqOpen && (
        <div className="md:hidden">
          <DrumMachine />
        </div>
      )}

      {showSync && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-black/20 p-2">
          <span className="label mr-1">Loop sync</span>
          <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={quantize} aria-label="クオンタイズ" onChange={(e) => useDJ.getState().setQuantize(e.target.value as "off")} title="ループ / フィル系パッドの開始を拍・小節の頭に揃える (再生中のデッキのビートグリッド基準)">
            <option value="off">Quantize off</option>
            <option value="beat">Q: 1 拍</option>
            <option value="bar">Q: 1 小節</option>
          </select>
          <button className={`btn ${autoMatch ? "btn-accent" : ""}`} aria-pressed={autoMatch} onClick={() => useDJ.getState().setAutoMatch(!autoMatch)} title="ループを押すたび、再生中の曲の BPM とキーに合わせて作り直してから鳴らす">
            Auto Match
          </button>
          <button className="btn" onClick={() => useDJ.getState().matchKey()} title="全ループを今の曲の BPM・キーに合わせて一括で作り直す">
            今すぐ全ループを合わせる
          </button>
          <button className="btn" onClick={() => useDJ.getState().resetLoops()} title="合わせたループを元のテンポ / キー (128 BPM・Am) に戻す">
            元に戻す
          </button>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2" role="grid" aria-label={`バンク ${BANK_NAMES[bank]} のパッド`}>
        {pads.map((pad, local) => {
          const active = activePads.includes(pad.index);
          const selected = editing === pad.index;
          const key = PAD_KEYS[local];
          const filled = !!pad.sampleId || !!pad.speech;
          return (
            <div key={pad.index} className="relative">
              <Pad
                pad={pad}
                keyLabel={key}
                active={active}
                selected={selected}
                filled={filled}
                editing={editing != null}
                onPress={() => pressPad(pad.index)}
                onRelease={() => releasePad(pad.index)}
                onEdit={() => setEditing(pad.index)}
                onDrop={async (e) => {
                  const sid = e.dataTransfer.getData("sample-id");
                  if (sid) return assignSample(pad.index, sid);
                  if (e.dataTransfer.files.length) {
                    const before = useDJ.getState().samples.length;
                    await importSamples([e.dataTransfer.files[0]]);
                    const s = useDJ.getState().samples;
                    if (s.length > before) assignSample(pad.index, s[0].id);
                  }
                }}
              />
              {active && (
                <button
                  type="button"
                  aria-label="このパッドを停止"
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded bg-black/60 text-[10px] text-white"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    useDJ.getState().stopPad(pad.index);
                  }}
                >
                  ■
                </button>
              )}
            </div>
          );
        })}
      </div>

      {edit && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-panel-2 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">
              Bank {BANK_NAMES[Math.floor(edit.index / PADS_PER_BANK)]} · Pad {(edit.index % PADS_PER_BANK) + 1} <span className="font-mono text-zinc-500">[{PAD_KEYS[edit.index % PADS_PER_BANK]}]</span>
            </span>
            <div className="flex items-center gap-1">
              <button className="btn mr-2" onClick={() => void useDJ.getState().previewSample(edit.sampleId!)} disabled={!edit.sampleId} title="このパッドのサンプルを試聴">
                ▶ 試聴
              </button>
              {PAD_COLORS.map((c) => (
                <button key={c} className="h-5 w-5 rounded-full border border-black/40" style={{ background: c, outline: edit.color === c ? "2px solid white" : undefined }} onClick={() => updatePad(edit.index, { color: c })} aria-label={`色 ${c}`} aria-pressed={edit.color === c} />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="label">Sample</span>
              <select className="rounded border border-border bg-panel px-2 py-1 text-xs" value={edit.sampleId ?? ""} onChange={(e) => assignSample(edit.index, e.target.value || null)}>
                <option value="">— none —</option>
                {samples.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.duration.toFixed(1)}s)
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">Name</span>
              <input className="rounded border border-border bg-panel px-2 py-1 text-xs" value={edit.name} onChange={(e) => updatePad(edit.index, { name: e.target.value })} />
            </label>
          </div>
          {edit.sampleId && <PadWave padIndex={edit.index} start={edit.start} end={edit.end} color={edit.color} onChange={(start, end) => updatePad(edit.index, { start, end })} />}
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="再生モード">
            {MODES.map((m) => (
              <button key={m.id} role="radio" aria-checked={edit.mode === m.id} className={`btn ${edit.mode === m.id ? "btn-accent" : ""}`} title={m.hint} onClick={() => updatePad(edit.index, { mode: m.id })}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="label">VJ effect</span>
              <select className="rounded border border-border bg-panel px-2 py-1 text-xs" value={edit.fx ?? "pulse"} onChange={(e) => updatePad(edit.index, { fx: e.target.value as VJFxId })}>
                {VJ_FX.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">Effect text / emoji</span>
              <input className="rounded border border-border bg-panel px-2 py-1 text-xs" placeholder="HEY! / 🎉🔥" value={edit.fxText ?? ""} onChange={(e) => updatePad(edit.index, { fxText: e.target.value })} />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="label">読み上げテキスト (サンプル未割り当て時にブラウザ音声で再生。自分の音声ファイルを割り当てればそちらが優先)</span>
            <input className="rounded border border-border bg-panel px-2 py-1 text-xs" placeholder="例: ドッキリかよ！" value={edit.speech ?? ""} onChange={(e) => updatePad(edit.index, { speech: e.target.value })} />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="label">Gain {edit.gain.toFixed(2)}</span>
              <input type="range" min={0} max={2} step={0.01} value={edit.gain} onChange={(e) => updatePad(edit.index, { gain: parseFloat(e.target.value) })} onDoubleClick={() => updatePad(edit.index, { gain: 1 })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">
                Pitch {edit.pitch > 0 ? "+" : ""}
                {edit.pitch} st
              </span>
              <input type="range" min={-12} max={12} step={1} value={edit.pitch} onChange={(e) => updatePad(edit.index, { pitch: parseInt(e.target.value) })} onDoubleClick={() => updatePad(edit.index, { pitch: 0 })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">Choke group</span>
              <select className="rounded border border-border bg-panel px-2 py-1 text-xs" value={edit.choke} onChange={(e) => updatePad(edit.index, { choke: parseInt(e.target.value) })}>
                <option value={0}>none</option>
                {[1, 2, 3, 4].map((g) => (
                  <option key={g} value={g}>
                    group {g}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex justify-end">
            <button
              className="btn btn-danger"
              disabled={!edit.sampleId && !edit.speech}
              onClick={() =>
                useDJ.getState().confirm({
                  title: "このパッドを空にしますか？",
                  message: "サンプル自体はライブラリに残ります。",
                  confirmLabel: "空にする",
                  danger: true,
                  onConfirm: () => {
                    useDJ.getState().rememberRemoved([`pad:${edit.index}`]);
                    void updatePad(edit.index, { sampleId: null, name: "", speech: undefined, start: undefined, end: undefined }).then(() => assignSample(edit.index, null));
                  },
                })
              }
            >
              パッドを空にする
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface PadProps {
  pad: { index: number; name: string; color: string; sampleId: string | null; speech?: string; mode: PadMode; choke: number; loopBpm?: number };
  keyLabel: string;
  active: boolean;
  selected: boolean;
  filled: boolean;
  editing: boolean;
  onPress: () => void;
  onRelease: () => void;
  onEdit: () => void;
  onDrop: (e: React.DragEvent) => void;
}

/** One pad. Tap plays (gate / loop pads play while held); right-click opens the editor. In edit mode a tap selects. */
function Pad({ pad, keyLabel, active, selected, filled, editing, onPress, onRelease, onEdit, onDrop }: PadProps) {
  return (
    <button
      type="button"
      aria-label={`${pad.name || "空のパッド"} (キー ${keyLabel.toUpperCase()})`}
      aria-pressed={active}
      className={`relative flex aspect-square w-full touch-none select-none flex-col items-start justify-between rounded-lg border p-2 text-left transition-transform active:scale-95 ${selected ? "ring-2 ring-white" : ""} ${active ? "pad-hit" : ""}`}
      style={{
        borderColor: filled ? pad.color : "#27272a",
        background: filled ? `${pad.color}${active ? "cc" : "33"}` : "#131316",
        boxShadow: active ? `0 0 24px ${pad.color}` : undefined,
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (editing) return onEdit();
        e.currentTarget.setPointerCapture(e.pointerId);
        onPress();
      }}
      onPointerUp={() => !editing && onRelease()}
      onPointerCancel={onRelease}
      onContextMenu={(e) => {
        e.preventDefault();
        onEdit();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(e);
      }}
    >
      <span className="font-mono text-[10px] uppercase text-white/60">{keyLabel}</span>
      <span className="w-full truncate text-xs font-semibold text-white">{pad.name || <span className="text-white/30">empty</span>}</span>
      <span className="text-[9px] uppercase text-white/50">
        {pad.speech && !pad.sampleId ? "🗣 voice" : pad.mode}
        {pad.loopBpm ? " ♪" : ""}
        {pad.choke ? ` · C${pad.choke}` : ""}
      </span>
    </button>
  );
}
