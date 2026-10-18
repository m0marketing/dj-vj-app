import { NextRequest, NextResponse } from "next/server";
import { safeNext, SESSION_COOKIE, verifySession } from "@/lib/auth";
import { bearerOwner, verifyRehearsalTicket } from "@/lib/automation/security";

const PUBLIC_PATHS = new Set(["/favicon.ico", "/icon.svg", "/icon-maskable.svg", "/manifest.webmanifest", "/sw.js", "/keylock-worklet.js", "/scratch-worklet.js"]);

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Machine routes authenticate in their handlers; bearer auth never grants a Studio session.
  if (path === "/api/mcp" || path === "/api/automation/dispatch" || (path.startsWith("/api/automation") && bearerOwner(request))) return NextResponse.next();
  if (path === "/rehearsal" && verifyRehearsalTicket(request.nextUrl.searchParams.get("ticket"))) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }
  if (PUBLIC_PATHS.has(path) || path === "/api/auth/login" || path === "/api/auth/logout") return NextResponse.next();
  const authenticated = verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  let response: NextResponse;
  if (path === "/login") {
    response = authenticated ? NextResponse.redirect(new URL(safeNext(request.nextUrl.searchParams.get("next")), request.url)) : NextResponse.next();
  } else if (!authenticated) {
    if (path.startsWith("/api/")) response = NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    else {
      const login = new URL("/login", request.url);
      login.searchParams.set("next", path + request.nextUrl.search);
      response = NextResponse.redirect(login);
    }
  } else response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
