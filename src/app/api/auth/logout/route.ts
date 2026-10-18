import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, SESSION_COOKIE } from "@/lib/auth";

export function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "この画面から操作してください。" }, { status: 403 });
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
