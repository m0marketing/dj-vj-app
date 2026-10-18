"use client";

import { useEffect, useRef, useState } from "react";
import { useDJ } from "@/lib/store";
import type { ToastKind } from "@/lib/types";

const STYLE: Record<ToastKind, string> = {
  info: "border-border bg-panel text-zinc-200",
  success: "border-emerald-500/50 bg-emerald-950/90 text-emerald-100",
  error: "border-rose-500/60 bg-rose-950/90 text-rose-100",
  progress: "border-accent/40 bg-panel text-accent",
};
const TTL: Record<ToastKind, number> = { info: 3000, success: 3000, error: 6000, progress: Infinity };

interface Item {
  id: number;
  text: string;
  kind: ToastKind;
  action: { label: string; onClick: () => void } | null;
  at: number;
}

/**
 * Up to three stacked notifications. New messages do not wipe the previous one, so an error is never hidden
 * behind the success toast that follows it; progress toasts replace each other (only one at a time).
 */
export default function Toast() {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);

  useEffect(
    () =>
      useDJ.subscribe((s, prev) => {
        if (s.toast === prev.toast && s.toastKind === prev.toastKind && s.toastAction === prev.toastAction) return;
        if (!s.toast) {
          // Explicit clear (setToast(null)) removes the progress toast.
          setItems((list) => list.filter((i) => i.kind !== "progress"));
          return;
        }
        const item: Item = { id: ++seq.current, text: s.toast, kind: s.toastKind, action: s.toastAction, at: Date.now() };
        setItems((list) => {
          const rest = s.toastKind === "progress" ? list.filter((i) => i.kind !== "progress") : list.filter((i) => i.text !== s.toast);
          return [...rest, item].slice(-3);
        });
      }),
    [],
  );

  useEffect(() => {
    if (!items.some((i) => i.kind !== "progress")) return;
    const t = setInterval(() => {
      const now = Date.now();
      setItems((list) => list.filter((i) => now - i.at < TTL[i.kind]));
    }, 500);
    return () => clearInterval(t);
  }, [items]);

  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 flex w-[min(92vw,40rem)] -translate-x-1/2 flex-col-reverse gap-1.5 md:bottom-4">
      {items.map((i) => (
        <div key={i.id} role="status" aria-live={i.kind === "error" ? "assertive" : "polite"} className={`pointer-events-auto flex items-center gap-2 rounded-md border px-4 py-2 text-xs shadow-lg ${STYLE[i.kind]}`}>
          {i.kind === "progress" && <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />}
          <span className="min-w-0 flex-1 truncate">{i.text}</span>
          {i.action && (
            <button
              className="shrink-0 rounded border border-current/40 px-2 py-0.5 font-semibold hover:bg-white/10"
              onClick={() => {
                i.action!.onClick();
                setItems((list) => list.filter((x) => x.id !== i.id));
              }}
            >
              {i.action.label}
            </button>
          )}
          <button className="-mr-2 px-1 opacity-60 hover:opacity-100" onClick={() => setItems((list) => list.filter((x) => x.id !== i.id))} aria-label="閉じる">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
