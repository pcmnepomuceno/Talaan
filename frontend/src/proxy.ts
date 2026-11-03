import { NextResponse, type NextRequest } from "next/server";

// Next 16 renamed middleware.ts to proxy.ts. This is an optimistic guard: it only checks that a
// session cookie EXISTS (either name: __Host- when the API runs with COOKIE_SECURE=true). It does
// not validate it; the API is the authority. A stale cookie gets through here, the first API call
// answers 401, and the fetch wrapper sends the user to /login?expired=1. Redirecting on a stale
// cookie here instead would loop (/login would bounce back to the app).
// It never redirects away from /login for the same reason: the login page asks /me itself.
const COOKIES = ["session_token", "__Host-session_token"];
const PUBLIC = ["/login", "/design"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // /api is the backend (rewritten in next.config.ts): it answers 401 itself, never redirect it.
  if (pathname === "/api" || pathname.startsWith("/api/")) return NextResponse.next();
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (COOKIES.some((name) => request.cookies.has(name))) return NextResponse.next();

  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)"],
};
