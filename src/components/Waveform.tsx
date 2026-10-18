"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getEngine } from "@/lib/audio/engine";
import type { DeckId } from "@/lib/types";

interface Props {
  deck: DeckId;
  trackId: string | null;
  position: number;
  duration: number;
  cues: (number | null)[];
  cuePoint?: number;
  mark?: number | null;
  chorus?: [number, number][] | null;
  /** Vocal presence per bar (0..1) + grid, drawn as a thin strip along the top. */
  vocal?: { map: number[]; bpm: number; beatOffset: number } | null;
  loop: { in: number | null; out: number | null; active: boolean };
  onSeek: (t: number) => void;
  /** Shift + drag: mark a chorus range (seconds, unsnapped - the store snaps to bars). */
  onMarkChorus?: (start: number, end: number) => void;
  /** Right-click: set the OUT (mix-out) point here; right-click on the existing mark clears it. */
  onMarkOut?: (t: number | null) => void;
  color: string;
}

function computePeaks(buffer: AudioBuffer, n: number) {
  const data = buffer.getChannelData(0);
  const step = Math.floor(data.length / n);
  const peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let max = 0;
    const start = i * step;
    for (let j = 0; j < step; j += 8) max = Math.max(max, Math.abs(data[start + j]));
    peaks[i] = max;
  }
  return peaks;
}

/** Whole-track overview. Click or drag to seek. */
export default function Waveform({ deck, trackId, position, duration, cues, cuePoint, loop, onSeek, color, mark, chorus, vocal, onMarkChorus, onMarkOut }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const dragging = useRef(false);
  const marking = useRef<{ start: number; end: number } | null>(null);
  const [markPreview, setMarkPreview] = useState<{ start: number; end: number } | null>(null);
  const peaks = useMemo(() => {
    if (!trackId) return null;
    const buf = getEngine().decks[deck].buffer;
    return buf ? computePeaks(buf, 400) : null;
  }, [deck, trackId]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => setWidth(canvas.clientWidth));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!peaks || !duration) {
      ctx.fillStyle = "#3f3f46";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("ライブラリからトラックをロード (ここにドロップ)", w / 2, h / 2 + 4);
      return;
    }
    const progress = position / duration;
    if (vocal?.map.length) {
      const barSec = 240 / vocal.bpm;
      for (let i = 0; i < vocal.map.length; i++) {
        const v = vocal.map[i];
        if (v < 0.45) continue;
        const x0 = ((vocal.beatOffset + i * barSec) / duration) * w;
        const x1 = ((vocal.beatOffset + (i + 1) * barSec) / duration) * w;
        ctx.fillStyle = `rgba(244,114,182,${0.25 + (v - 0.45) * 1.1})`;
        ctx.fillRect(x0, 0, Math.max(1, x1 - x0), 3);
      }
    }
    for (const [a, b] of chorus ?? []) {
      const x0 = (a / duration) * w;
      const x1 = (b / duration) * w;
      ctx.fillStyle = "rgba(250,204,21,0.16)";
      ctx.fillRect(x0, 0, x1 - x0, h);
      ctx.fillStyle = "#facc15";
      ctx.fillRect(x0, 0, 1, h);
      ctx.fillRect(x1 - 1, 0, 1, h);
      if (x1 - x0 > 18) {
        ctx.font = "bold 8px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("サビ", x0 + 3, h - 3);
      }
    }
    if (loop.in != null && loop.out != null) {
      ctx.fillStyle = loop.active ? "rgba(34,197,94,0.25)" : "rgba(34,197,94,0.1)";
      ctx.fillRect((loop.in / duration) * w, 0, ((loop.out - loop.in) / duration) * w, h);
    }
    const bw = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const ph = Math.max(1, peaks[i] * h * 0.9);
      ctx.fillStyle = i / peaks.length < progress ? color : "#52525b";
      ctx.fillRect(i * bw, (h - ph) / 2, Math.max(1, bw - 0.5), ph);
    }
    if (cuePoint != null && cuePoint > 0) {
      const x = (cuePoint / duration) * w;
      ctx.fillStyle = "#f97316";
      ctx.fillRect(x - 1, 0, 2, h);
      ctx.beginPath();
      ctx.moveTo(x - 5, h);
      ctx.lineTo(x + 5, h);
      ctx.lineTo(x, h - 6);
      ctx.closePath();
      ctx.fill();
    }
    cues.forEach((c, i) => {
      if (c == null) return;
      const x = (c / duration) * w;
      ctx.fillStyle = ["#f43f5e", "#f97316", "#eab308", "#a855f7"][i];
      ctx.fillRect(x - 1, 0, 2, h);
      ctx.fillRect(x - 1, 0, 10, 10);
      ctx.fillStyle = "#000";
      ctx.font = "bold 8px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`${i + 1}`, x + 1, 8);
    });
    if (mark != null) {
      const mx = (mark / duration) * w;
      ctx.fillStyle = "rgba(244,63,94,0.18)";
      ctx.fillRect(mx, 0, w - mx, h);
      ctx.fillStyle = "#f43f5e";
      ctx.fillRect(mx - 1, 0, 2, h);
      ctx.font = "bold 8px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText("OUT", mx - 3, h - 3);
    }
    ctx.fillStyle = "#fff";
    ctx.fillRect(progress * w - 1, 0, 2, h);
    if (markPreview) {
      const a = (Math.min(markPreview.start, markPreview.end) / duration) * w;
      const b = (Math.max(markPreview.start, markPreview.end) / duration) * w;
      ctx.fillStyle = "rgba(251, 191, 36, 0.25)";
      ctx.fillRect(a, 0, Math.max(2, b - a), h);
      ctx.strokeStyle = "rgba(251, 191, 36, 0.9)";
      ctx.strokeRect(a + 0.5, 0.5, Math.max(2, b - a) - 1, h - 1);
    }
  }, [peaks, position, duration, cues, cuePoint, loop, color, width, mark, chorus, vocal, markPreview]);

  const timeAt = (e: React.PointerEvent | React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
  };
  const seekAt = (e: React.PointerEvent) => onSeek(timeAt(e));

  return (
    <canvas
      ref={canvasRef}
      aria-label="トラック全体の波形 (クリック / ドラッグでシーク、Shift + ドラッグでサビ範囲、右クリックで OUT)"
      title="クリック / ドラッグ: シーク · Shift + ドラッグ: サビ範囲を指定 · 右クリック: OUT (自動ミックスで曲を終える位置) を置く / 消す"
      className="h-10 w-full cursor-crosshair touch-none rounded bg-black/40 sm:h-12"
      onPointerDown={(e) => {
        if (!duration || e.button === 2) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        if (e.shiftKey && onMarkChorus) {
          const t = timeAt(e);
          marking.current = { start: t, end: t };
          setMarkPreview(marking.current);
          return;
        }
        dragging.current = true;
        seekAt(e);
      }}
      onPointerMove={(e) => {
        if (marking.current) {
          marking.current = { ...marking.current, end: timeAt(e) };
          setMarkPreview({ ...marking.current });
          return;
        }
        if (dragging.current) seekAt(e);
      }}
      onPointerUp={() => {
        dragging.current = false;
        const m = marking.current;
        marking.current = null;
        setMarkPreview(null);
        if (m && onMarkChorus) {
          const a = Math.min(m.start, m.end);
          const b = Math.max(m.start, m.end);
          if (b - a > 1) onMarkChorus(a, b);
        }
      }}
      onPointerCancel={() => {
        dragging.current = false;
        marking.current = null;
        setMarkPreview(null);
      }}
      onContextMenu={(e) => {
        if (!onMarkOut || !duration) return;
        e.preventDefault();
        const t = timeAt(e);
        // Right-click within 1.5% of the existing OUT mark clears it.
        onMarkOut(mark != null && Math.abs(mark - t) < duration * 0.015 ? null : t);
      }}
    />
  );
}
