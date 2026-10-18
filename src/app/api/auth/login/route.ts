import { NextRequest, NextResponse } from "next/server";
import { authConfigured, checkAccessCode, createSession, safeNext, sameOrigin, SESSION_COOKIE, SESSION_SECONDS } from "@/lib/auth";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "この画面からもう一度ログインしてください。" }, { status: 403, headers });
  if (!authConfigured()) return NextResponse.json({ error: "アクセスコードが設定されていません。管理者に確認してください。" }, { status: 503, headers });
  if (Number(request.headers.get("content-length")) > 4096) return NextResponse.json({ error: "入力が長すぎます。" }, { status: 413, headers });
  let input: { code?: unknown; next?: unknown };
  try {
    input = await request.json();
    if (!input || typeof input !== "object") throw new Error("Invalid input");
  } catch {
    return NextResponse.json({ error: "アクセスコードを入力してください。" }, { status: 400, headers });
  }
  if (!checkAccessCode(input.code)) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return NextResponse.json({ error: "アクセスコードが違います。もう一度お試しください。" }, { status: 401, headers });
  }
  const response = NextResponse.json({ next: safeNext(input.next) }, { headers });
  response.cookies.set(SESSION_COOKIE, createSession(), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_SECONDS });
  return response;
}
