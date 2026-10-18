import type { Metadata } from "next";
import LoginForm from "@/components/LoginForm";

export const metadata: Metadata = { title: "ログイン | DJ/VJ Studio", robots: { index: false, follow: false } };

export default function LoginPage() {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-12">
      <div aria-hidden="true" className="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-accent/10 blur-[100px]" />
      <section className="panel relative w-full max-w-md p-7 sm:p-10" aria-labelledby="login-title">
        <p className="mb-8 font-mono text-[10px] tracking-[0.3em] text-accent">YOUR PRIVATE BOOTH</p>
        <h1 id="login-title" className="text-3xl font-bold tracking-tight">DJ<span className="text-accent">/</span>VJ Studio</h1>
        <p className="mb-8 mt-3 text-sm leading-relaxed text-zinc-400">アクセスコードを入力して、<br />スタジオにログインしてください。</p>
        <LoginForm />
        <div className="mt-8 border-t border-border pt-5 text-xs leading-relaxed text-zinc-500">
          <p>音源と設定は、このブラウザに保存されます。</p>
          <p className="mt-1">端末間の同期はありません。別の端末で使うときは、ライブラリのバックアップを読み込んでください。</p>
        </div>
      </section>
    </main>
  );
}
