"use client";

import { useEffect, useState } from "react";
import VJCanvas from "@/components/VJCanvas";

/**
 * Projector output. Open from the main studio tab; it receives audio features
 * via BroadcastChannel so no audio is played here. Click/F = fullscreen.
 */
export default function VJProjectorPage() {
  const [hint, setHint] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 4000);
    const onKey = (e: KeyboardEvent) => e.key.toLowerCase() === "f" && document.documentElement.requestFullscreen?.();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <div className="fixed inset-0 cursor-none bg-black" onClick={() => document.documentElement.requestFullscreen?.()}>
      <VJCanvas source="remote" />
      {hint && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1.5 text-xs text-white/70">
          メインタブで再生すると同期します · クリック / F でフルスクリーン
        </div>
      )}
    </div>
  );
}
