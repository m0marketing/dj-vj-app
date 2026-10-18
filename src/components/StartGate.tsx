"use client";

import { useState } from "react";
import { useDJ } from "@/lib/store";

/** Browsers require a user gesture before AudioContext can start. */
export default function StartGate() {
  const ready = useDJ((s) => s.ready);
  const init = useDJ((s) => s.init);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (ready) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/95 backdrop-blur">
      <div className="panel m-4 flex max-w-md flex-col items-center gap-4 p-6 text-center sm:p-8">
        <h1 className="text-3xl font-bold tracking-tight">
          DJ<span className="text-accent">/</span>VJ Studio
        </h1>
        <p className="text-sm text-zinc-400">
          2 デッキ DJ・128 パッドサンプラー・音に反応する VJ。
          <br />
          音源はこのブラウザ内 (IndexedDB) に保存され、サーバーには送られません。
        </p>
        <button
          className="btn btn-primary px-6 py-3 text-base"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try { await init(); }
            catch { setError("音声または保存データを読み込めませんでした。再度スタートを押してください。"); }
            finally { setBusy(false); }
          }}
        >
          {busy ? "起動中…" : "▶ スタート"}
        </button>
        {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
        <ul className="flex flex-col gap-1 text-left text-[11px] leading-relaxed text-zinc-500">
          <li>・ヘッドホン / スピーカーの音量にご注意ください</li>
          <li>・VJ には点滅 (ストロボ) 演出が含まれます。光過敏の方がいる場では VJ パネルの「Strobe」を OFF にしてください</li>
          <li>
            ・キーボード操作は <kbd className="rounded border border-border px-1 font-mono">?</kbd> で一覧できます
          </li>
        </ul>
      </div>
    </div>
  );
}
