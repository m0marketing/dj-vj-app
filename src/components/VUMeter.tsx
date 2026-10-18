"use client";

import { useEffect, useRef } from "react";
import { featureBus } from "@/lib/vj/featureBus";

/** Master level meter driven by the feature bus (no extra analyser needed). */
export default function VUMeter() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let peak = 0;
    return featureBus.subscribe(({ features }) => {
      const w = canvas.width;
      const h = canvas.height;
      const level = Math.min(1, features.level * 1.6);
      peak = Math.max(level, peak * 0.97);
      ctx.clearRect(0, 0, w, h);
      const segs = 24;
      for (let i = 0; i < segs; i++) {
        const x = (i / segs) * w;
        const on = i / segs < level;
        const col = i > segs * 0.85 ? "#f43f5e" : i > segs * 0.65 ? "#eab308" : "#22c55e";
        ctx.fillStyle = on ? col : "#27272a";
        ctx.fillRect(x + 1, 0, w / segs - 2, h);
      }
      ctx.fillStyle = "#fff";
      ctx.fillRect(peak * w - 1, 0, 2, h);
    });
  }, []);
  return <canvas ref={ref} width={240} height={8} className="h-2 w-full rounded" />;
}
