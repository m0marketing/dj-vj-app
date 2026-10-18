"use client";

import { useEffect, useRef } from "react";
import { getEngine } from "@/lib/audio/engine";
import type { DeckId } from "@/lib/types";

interface Props {
  deck: DeckId;
  color: string;
  onNudge: (deltaSeconds: number) => void;
  onBendEnd?: () => void;
  /** Vinyl mode: dragging while playing scratches (backwards too) instead of nudging the tempo. */
  vinyl?: boolean;
}

/**
 * CDJ-style jog wheel: spins while playing, shows position ring + per-deck VU.
 * Paused: drag scrubs through the track. Playing: drag nudges the tempo (forward = faster, back = slower),
 * which stays glitch-free because the source keeps running.
 */
export default function Platter({ deck, color, onNudge, onBendEnd, vinyl = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ angle: number; last: number; bend: boolean; scratch: boolean } | null>(null);
  const bendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scratchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const engine = getEngine();
    const d = engine.decks[deck];
    const data = new Uint8Array(d.analyser.fftSize);
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dpr = window.devicePixelRatio || 1;
      const size = canvas.clientWidth;
      if (size < 40) return;
      if (canvas.width !== size * dpr) {
        canvas.width = canvas.height = size * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const c = size / 2;
      const r = c - 4;

      d.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += ((data[i] - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / data.length);

      // outer VU ring
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.strokeStyle = "#27272a";
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c, c, r, -Math.PI / 2, -Math.PI / 2 + Math.min(1, rms * 3) * Math.PI * 2);
      ctx.strokeStyle = rms > 0.3 ? "#f43f5e" : color;
      ctx.lineWidth = 6;
      ctx.stroke();

      // position ring
      const prog = d.duration ? d.position / d.duration : 0;
      ctx.beginPath();
      ctx.arc(c, c, r - 10, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
      ctx.strokeStyle = "#e4e4e7";
      ctx.lineWidth = 3;
      ctx.stroke();

      // platter body
      const grad = ctx.createRadialGradient(c, c, 10, c, c, r - 16);
      grad.addColorStop(0, "#2a2a30");
      grad.addColorStop(1, "#0f0f12");
      ctx.beginPath();
      ctx.arc(c, c, r - 16, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // spinning marker (~33 rpm; position already includes the playback rate)
      const angle = (d.position * 0.55 * Math.PI * 2) % (Math.PI * 2);
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -(r - 20));
      ctx.lineTo(0, -(r - 40));
      ctx.strokeStyle = d.playing ? color : "#52525b";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.stroke();
      for (let i = 1; i < 8; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, 14 + i * ((r - 44) / 8), 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();

      // center label
      ctx.fillStyle = d.playing ? color : "#71717a";
      ctx.font = `bold ${Math.max(10, size * 0.09)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(d.scratching ? "SCRATCH" : d.playing ? (drag.current?.bend ? "NUDGE" : vinyl ? "VINYL" : "PLAY") : d.track ? "CUE" : "—", c, c);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [deck, color, vinyl]);

  const angleOf = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };

  const release = () => {
    const d = getEngine().decks[deck];
    if (drag.current?.scratch) {
      if (scratchTimer.current) clearTimeout(scratchTimer.current);
      d.scratchEnd("here");
      onBendEnd?.();
    } else if (drag.current?.bend) {
      d.bend(1);
      onBendEnd?.();
    }
    if (bendTimer.current) clearTimeout(bendTimer.current);
    drag.current = null;
  };

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={vinyl ? "ジョグホイール (VINYL: ドラッグでスクラッチ)" : "ジョグホイール (停止中: ドラッグでスクラブ / 再生中: ドラッグでテンポを一時的に前後)"}
      className="aspect-square w-full cursor-grab touch-none active:cursor-grabbing"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const d = getEngine().decks[deck];
        const scratch = vinyl && !!d.track && d.scratchBegin();
        drag.current = { angle: angleOf(e), last: performance.now(), bend: !scratch && d.playing, scratch };
      }}
      onPointerMove={(e) => {
        const dr = drag.current;
        if (!dr) return;
        const a = angleOf(e);
        let delta = a - dr.angle;
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        dr.angle = a;
        const now = performance.now();
        const dt = Math.max(8, now - dr.last) / 1000;
        dr.last = now;
        if (dr.scratch) {
          // Hand speed -> read-head rate. One full turn = 1.8 s of audio (33 rpm feel); the record stops when the hand does.
          const turnsPerSec = delta / (Math.PI * 2) / dt;
          getEngine().decks[deck].scratchRate(Math.max(-8, Math.min(8, turnsPerSec * 1.8)), 0.012);
          if (scratchTimer.current) clearTimeout(scratchTimer.current);
          scratchTimer.current = setTimeout(() => getEngine().decks[deck].scratchRate(0, 0.02), 70);
        } else if (dr.bend) {
          // Angular velocity (turns/s) -> rate multiplier; snaps back to 1 when the hand stops.
          const turnsPerSec = delta / (Math.PI * 2) / dt;
          getEngine().decks[deck].bend(Math.max(0.1, Math.min(3, 1 + turnsPerSec * 0.5)));
          if (bendTimer.current) clearTimeout(bendTimer.current);
          bendTimer.current = setTimeout(() => getEngine().decks[deck].bend(1), 120);
        } else onNudge((delta / (Math.PI * 2)) * 4); // one full turn ≈ 4 seconds
      }}
      onPointerUp={release}
      onPointerCancel={release}
    />
  );
}
