"use client";

import { useEffect, useMemo, useState } from "react";
import { getMidi, midiTargets, type MidiState } from "@/lib/midi";

/** MIDI learn: pick a target, move / press the control, done. Bindings persist in this browser. */
export default function MidiPanel({ onClose }: { onClose: () => void }) {
  const midi = getMidi();
  const [st, setSt] = useState<MidiState>(midi.state);
  useEffect(() => midi.subscribe(setSt), [midi]);
  const targets = useMemo(() => midiTargets(), []);
  const groups = useMemo(() => [...new Set(targets.map((t) => t.group))], [targets]);
  const bindingFor = (id: string) => Object.entries(st.map).find(([, t]) => t === id)?.[0] ?? null;

  return (
    <div className="fixed inset-0 z-[46] grid place-items-center bg-black/70 p-4" role="dialog" aria-label="MIDI コントローラー" onClick={onClose}>
      <div className="panel flex max-h-[90vh] w-full max-w-3xl flex-col gap-3 overflow-hidden p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">🎹 MIDI コントローラー</h2>
          {!st.supported && <span className="text-xs text-amber-300">このブラウザは Web MIDI 非対応です (Chrome / Edge を使ってください)</span>}
          {st.supported && !st.enabled && (
            <button className="btn btn-primary" onClick={() => void midi.enable()}>
              接続 (許可を求めます)
            </button>
          )}
          {st.enabled && <span className="text-xs text-emerald-300">入力: {st.inputs.length ? st.inputs.join(", ") : "なし (コントローラーを挿してください)"}</span>}
          <span className="ml-auto font-mono text-[10px] text-zinc-500">{st.last ? `最後の信号: ${st.last}` : ""}</span>
          <button className="btn" onClick={() => midi.clear()} disabled={!Object.keys(st.map).length}>
            全部解除
          </button>
          <button className="btn" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <p className="text-[11px] text-zinc-500">「ラーン」を押してから、コントローラーのつまみを動かす / ボタンを押すと割り当てられます。フェーダー・ノブは CC、パッドやボタンはノート (押している間だけ効くものはノートで)。</p>
        {st.learning && <div className="animate-pulse rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-sm text-accent">待機中: 「{targets.find((t) => t.id === st.learning)?.label}」に割り当てるコントロールを動かしてください… <button className="btn ml-2 py-0.5" onClick={() => midi.learn(null)}>やめる</button></div>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.map((g) => (
            <div key={g} className="mb-3">
              <div className="label mb-1">{g}</div>
              <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {targets
                  .filter((t) => t.group === g)
                  .map((t) => {
                    const b = bindingFor(t.id);
                    return (
                      <div key={t.id} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${st.learning === t.id ? "border-accent bg-accent/10" : "border-border/60 bg-black/20"}`}>
                        <span className="min-w-0 flex-1 truncate">{t.label}</span>
                        <span className="font-mono text-[10px] text-zinc-500">{b ?? "—"}</span>
                        <button className="btn py-0.5" disabled={!st.enabled} onClick={() => midi.learn(st.learning === t.id ? null : t.id)}>
                          ラーン
                        </button>
                        {b && (
                          <button className="btn py-0.5" onClick={() => midi.unbind(t.id)} aria-label={`${t.label} の割り当てを解除`}>
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
