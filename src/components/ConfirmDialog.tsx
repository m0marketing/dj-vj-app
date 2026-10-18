"use client";

import { useEffect, useRef } from "react";
import { useDJ } from "@/lib/store";

/** In-app replacement for window.confirm(); opened via useDJ.getState().confirm({...}). */
export default function ConfirmDialog() {
  const req = useDJ((s) => s.confirmRequest);
  const close = useDJ((s) => s.closeConfirm);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!req) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [req, close]);
  if (!req) return null;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={close} role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="panel flex w-full max-w-sm flex-col gap-3 p-5" onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-title" className="text-sm font-semibold">
          {req.title}
        </h2>
        {req.message && <p className="text-xs text-zinc-400">{req.message}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={close}>
            キャンセル
          </button>
          <button
            ref={okRef}
            className={`btn ${req.danger ? "btn-danger" : "btn-primary"}`}
            onClick={() => {
              req.onConfirm();
              close();
            }}
          >
            {req.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
