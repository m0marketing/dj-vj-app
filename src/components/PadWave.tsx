"use client";

import { useEffect, useRef, useState } from "react";
import { getEngine } from "@/lib/audio/engine";

interface Props {
  padIndex: number;
  start?: number;
  end?: number;
  color: string;
  onChange: (start: number | undefined, end: number | undefined) => void;
}

/** Sample waveform with draggable start / end trim handles. */
export default function PadWave({ padIndex, start, end, color, onChange }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(0);
  const drag = useRef<"start" | "end" | null>(null);
  const buffer = getEngine().sampler.buffers.get(padIndex) ?? null;
  const dur = buffer?.duration ?? 0;
  const s = start ?? 0;
  const e = end ?? dur;

  useEffect(() => {
    const c = ref.current!;
    const ro = new ResizeObserver(() => setW(c.clientWidth));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) return;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!buffer) {
      ctx.fillStyle = "#52525b";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("サンプル未割り当て", cw / 2, ch / 2 + 4);
      return;
    }
    const data = buffer.getChannelData(0);
    const n = Math.floor(cw);
    const step = Math.max(1, Math.floor(data.length / n));
    const x0 = (s / dur) * cw;
    const x1 = (e / dur) * cw;
    for (let i = 0; i < n; i++) {
      let max = 0;
      const base = i * step;
      for (let j = 0; j < step; j += 2) max = Math.max(max, Math.abs(data[base + j] ?? 0));
      const ph = Math.max(1, max * ch * 0.9);
      const inside = i >= x0 && i <= x1;
      ctx.fillStyle = inside ? color : "#3f3f46";
      ctx.fillRect(i, (ch - ph) / 2, 1, ph);
    }
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, x0, ch);
    ctx.fillRect(x1, 0, cw - x1, ch);
    for (const [x, label] of [
      [x0, "S"],
      [x1, "E"],
    ] as const) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(x - 1, 0, 2, ch);
      ctx.fillRect(label === "S" ? x : x - 12, 0, 12, 12);
      ctx.fillStyle = "#000";
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, label === "S" ? x + 6 : x - 6, 9.5);
    }
  }, [buffer, s, e, dur, color, w]);

  const posOf = (ev: React.PointerEvent) => {
    const r = ev.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * dur;
  };

  return (
    <div className="flex flex-col gap-1">
      <canvas
        ref={ref}
        aria-label="サンプル波形 (S / E のハンドルをドラッグしてトリム)"
        className="h-16 w-full cursor-col-resize touch-none rounded bg-black/40"
        onPointerDown={(ev) => {
          if (!buffer) return;
          ev.currentTarget.setPointerCapture(ev.pointerId);
          const p = posOf(ev);
          drag.current = Math.abs(p - s) <= Math.abs(p - e) ? "start" : "end";
          const ns = drag.current === "start" ? Math.min(p, e - 0.01) : s;
          const ne = drag.current === "end" ? Math.max(p, s + 0.01) : e;
          onChange(ns, ne);
        }}
        onPointerMove={(ev) => {
          if (!drag.current) return;
          const p = posOf(ev);
          if (drag.current === "start") onChange(Math.min(p, e - 0.01), e);
          else onChange(s, Math.max(p, s + 0.01));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      <div className="flex items-center justify-between font-mono text-[10px] text-zinc-500">
        <span>
          S {s.toFixed(2)}s → E {e.toFixed(2)}s ({Math.max(0, e - s).toFixed(2)}s)
        </span>
        <button type="button" className="btn py-0.5" disabled={start == null && end == null} onClick={() => onChange(undefined, undefined)}>
          トリム解除
        </button>
      </div>
    </div>
  );
}
