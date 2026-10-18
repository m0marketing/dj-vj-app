"use client";

import { useEffect, useRef } from "react";
import { getEngine } from "@/lib/audio/engine";
import { useDJ } from "@/lib/store";
import { featureBus } from "@/lib/vj/featureBus";

/**
 * Energy + phrase readout for the playing deck: 8 beat dots (current bar), bar N of the 8-bar phrase,
 * and a countdown to the next phrase so Build & Drop / loop rolls can be aimed at a musical boundary.
 */
export default function PhraseMeter() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    let energy = 0;
    let peak = 0;
    let last = 0;
    return featureBus.subscribe(({ features }) => {
      const now = performance.now();
      if (now - last < 50) return;
      last = now;
      const level = Math.min(1, features.level * 1.6);
      energy += (level - energy) * 0.3;
      peak = Math.max(level, peak * 0.96);
      const { decks, crossfader } = useDJ.getState();
      const e = getEngine();
      const playing = (["A", "B"] as const).filter((id) => decks[id].playing && decks[id].track?.bpm);
      const id = playing.length === 1 ? playing[0] : playing.length ? (crossfader < 0.5 ? "A" : "B") : null;
      const w = c.width;
      const h = c.height;
      ctx.clearRect(0, 0, w, h);
      // Energy bar (left 60%)
      const ew = w * 0.6;
      const segs = 20;
      for (let i = 0; i < segs; i++) {
        const on = i / segs < energy;
        ctx.fillStyle = on ? (i > segs * 0.8 ? "#f43f5e" : i > segs * 0.6 ? "#eab308" : "#22d3ee") : "#27272a";
        ctx.fillRect((i / segs) * ew + 1, 0, ew / segs - 2, h);
      }
      ctx.fillStyle = "#fff";
      ctx.fillRect(peak * ew - 1, 0, 2, h);
      // Beat dots (right 40%): 16 beats = 4 bars of the 8-bar phrase shown as 8 bars x 4 beats condensed to 8 bar dots + 4 beat dots
      let label = "— no grid —";
      if (id) {
        const d = e.decks[id];
        const t = d.track!;
        const beats = ((d.position - (t.beatOffset ?? 0)) * t.bpm!) / 60;
        const beat = Math.floor(beats);
        const bar = Math.floor(beat / 4);
        const inPhrase = ((bar % 8) + 8) % 8;
        const beatInBar = ((beat % 4) + 4) % 4;
        const x0 = ew + 10;
        const dw = (w - x0) / 12;
        for (let i = 0; i < 8; i++) {
          ctx.fillStyle = i < inPhrase ? "#a78bfa" : i === inPhrase ? "#f472b6" : "#3f3f46";
          ctx.beginPath();
          ctx.arc(x0 + i * dw + dw / 2, h / 2, i === inPhrase ? h * 0.45 : h * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = i === beatInBar ? "#22d3ee" : "#3f3f46";
          ctx.fillRect(x0 + (8 + i) * dw + 2, h * 0.25, dw - 4, h * 0.5);
        }
        const barsLeft = 8 - inPhrase;
        const secsLeft = ((barsLeft * 4 - (beats - bar * 4)) * 60) / t.bpm! / d.rate;
        label = `Bar ${inPhrase + 1}/8 · 次のフレーズまで ${barsLeft} 小節 (${secsLeft.toFixed(1)}s)`;
      }
      if (textRef.current && textRef.current.textContent !== label) textRef.current.textContent = label;
    });
  }, []);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <canvas ref={canvas} width={320} height={10} className="h-2.5 w-full" aria-hidden />
      <span ref={textRef} className="truncate font-mono text-[10px] text-zinc-400" />
    </div>
  );
}
