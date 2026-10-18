"use client";

import { useEffect, useRef } from "react";
import { getEngine } from "@/lib/audio/engine";
import { useDJ } from "@/lib/store";
import type { DeckId } from "@/lib/types";

interface Props {
  deck: DeckId;
  trackId: string | null;
  color: string;
  /** Seconds visible across the canvas. */
  window?: number;
  onSeek: (t: number) => void;
}

const CUE_COLORS = ["#f43f5e", "#f97316", "#eab308", "#a855f7"];
const PX_PER_SEC = 200; // peak resolution

function peaksOf(buffer: AudioBuffer) {
  const n = Math.ceil(buffer.duration * PX_PER_SEC);
  const data = buffer.getChannelData(0);
  const data2 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const step = data.length / n;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step);
    const b = Math.floor((i + 1) * step);
    let max = 0;
    for (let j = a; j < b; j += 4) {
      const v = Math.abs(data2 ? (data[j] + data2[j]) * 0.5 : data[j]);
      if (v > max) max = v;
    }
    out[i] = max;
  }
  return out;
}

/**
 * Scrolling waveform centred on the playhead with the beat grid (bar lines brighter), cue points
 * and the loop region. Driven by requestAnimationFrame straight from the engine so it stays smooth.
 * Drag horizontally to scrub.
 */
export default function ZoomWave({ deck, trackId, color, window: win = 8, onSeek }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const peaks = useRef<Float32Array | null>(null);
  const drag = useRef<{ x: number; pos: number; was: boolean } | null>(null);

  useEffect(() => {
    const buf = trackId ? getEngine().decks[deck].buffer : null;
    peaks.current = buf ? peaksOf(buf) : null;
  }, [deck, trackId]);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const d = getEngine().decks[deck];
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const pk = peaks.current;
      const dur = d.duration;
      if (!pk || !dur) {
        ctx.fillStyle = "#3f3f46";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("ズーム波形 · ドラッグでスクラブ", w / 2, h / 2 + 4);
        return;
      }
      const pos = d.position;
      const t0 = pos - win / 2;
      const pxPerSec = w / win;
      const xOf = (t: number) => (t - t0) * pxPerSec;

      // Chorus region
      const ct = d.track;
      const chs: [number, number][] = ct?.choruses?.length ? ct.choruses : ct?.chorusStart != null && ct.chorusEnd != null ? [[ct.chorusStart, ct.chorusEnd]] : [];
      for (const [a, b] of chs) {
        if (b < t0 || a > t0 + win) continue;
        ctx.fillStyle = "rgba(250,204,21,0.10)";
        ctx.fillRect(xOf(a), 0, (b - a) * pxPerSec, h);
        ctx.fillStyle = "#facc15";
        ctx.fillRect(xOf(a) - 1, 0, 2, h);
        ctx.fillRect(xOf(b) - 1, 0, 2, h);
      }
      // Loop region
      if (d.loop.in != null && d.loop.out != null) {
        ctx.fillStyle = d.loop.active ? "rgba(34,197,94,0.22)" : "rgba(34,197,94,0.1)";
        ctx.fillRect(xOf(d.loop.in), 0, (d.loop.out - d.loop.in) * pxPerSec, h);
      }
      // Beat grid
      const bpm = d.track?.bpm;
      if (bpm) {
        const beat = 60 / bpm;
        const off = d.track?.beatOffset ?? 0;
        const first = Math.floor((t0 - off) / beat);
        for (let k = first; (off + k * beat) < t0 + win; k++) {
          const t = off + k * beat;
          if (t < 0 || t > dur) continue;
          const bar = ((k % 4) + 4) % 4 === 0;
          ctx.fillStyle = bar ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.14)";
          ctx.fillRect(xOf(t), bar ? 0 : h * 0.25, 1, bar ? h : h * 0.5);
        }
      }
      // Waveform
      const i0 = Math.max(0, Math.floor(t0 * PX_PER_SEC));
      const i1 = Math.min(pk.length, Math.ceil((t0 + win) * PX_PER_SEC));
      const colW = Math.max(1, pxPerSec / PX_PER_SEC);
      for (let i = i0; i < i1; i++) {
        const t = i / PX_PER_SEC;
        const x = xOf(t);
        const ph = Math.max(1, pk[i] * h * 0.92);
        ctx.fillStyle = t < pos ? color : "#71717a";
        ctx.fillRect(x, (h - ph) / 2, colW, ph);
      }
      // Cue points
      d.cues.forEach((c, i) => {
        if (c == null) return;
        const x = xOf(c);
        if (x < -4 || x > w + 4) return;
        ctx.fillStyle = CUE_COLORS[i];
        ctx.fillRect(x - 1, 0, 2, h);
        ctx.beginPath();
        ctx.moveTo(x - 6, 0);
        ctx.lineTo(x + 6, 0);
        ctx.lineTo(x, 7);
        ctx.closePath();
        ctx.fill();
      });
      // Main cue point
      {
        const x = xOf(d.cuePoint);
        if (x > -4 && x < w + 4) {
          ctx.fillStyle = "#f97316";
          ctx.fillRect(x - 1, 0, 2, h);
          ctx.font = "bold 8px sans-serif";
          ctx.textAlign = "left";
          ctx.fillText("CUE", x + 3, h - 3);
        }
      }
      // Playhead
      ctx.fillStyle = "#fff";
      ctx.fillRect(w / 2 - 1, 0, 2, h);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [deck, color, win]);

  const endDrag = () => {
    const dr = drag.current;
    drag.current = null;
    if (dr?.was) getEngine().decks[deck].play();
    useDJ.getState().syncDecks();
  };

  return (
    <canvas
      ref={ref}
      aria-label="ズーム波形 (ドラッグでスクラブ)"
      className="h-14 w-full cursor-ew-resize touch-none rounded bg-black/40 sm:h-16"
      onPointerDown={(e) => {
        const d = getEngine().decks[deck];
        if (!d.duration) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, pos: d.position, was: d.playing };
        if (d.playing) d.pause();
      }}
      onPointerMove={(e) => {
        const dr = drag.current;
        if (!dr) return;
        const w = e.currentTarget.clientWidth;
        const dt = -((e.clientX - dr.x) / w) * win;
        onSeek(dr.pos + dt);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}
