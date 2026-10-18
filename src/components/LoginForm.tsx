"use client";

import { useState } from "react";

export default function LoginForm() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, next: new URLSearchParams(window.location.search).get("next") }),
        });
        const data = await response.json();
        if (!response.ok) {
          setError(data.error ?? "ログインできませんでした。");
          setBusy(false);
          return;
        }
        setCode("");
        window.location.assign(data.next);
      } catch {
        setError("接続できませんでした。ネットワークを確認して、もう一度お試しください。");
        setBusy(false);
      }
    }}>
      <label htmlFor="access-code" className="mb-2 block text-sm font-medium">アクセスコード</label>
      <input id="access-code" name="code" type="password" autoComplete="current-password" required maxLength={256} value={code} onChange={(event) => setCode(event.target.value)} aria-describedby={error ? "login-error" : undefined} aria-invalid={Boolean(error)} disabled={busy} className="w-full rounded-lg border border-border bg-background px-4 py-3 text-base text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60" placeholder="アクセスコードを入力" />
      <div aria-live="polite" className="min-h-12 py-3">{error && <p id="login-error" role="alert" className="text-xs leading-relaxed text-rose-300">{error}</p>}</div>
      <button type="submit" disabled={busy || !code.trim()} className="btn btn-primary w-full justify-center py-3 text-sm">{busy ? "確認しています…" : "スタジオにログイン →"}</button>
    </form>
  );
}
