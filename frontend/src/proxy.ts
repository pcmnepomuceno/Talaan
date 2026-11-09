import { NextResponse, type NextRequest } from "next/server";

// Next 16 renamed middleware.ts to proxy.ts. This is an optimistic guard: it only checks that a
// session cookie EXISTS (either name: __Host- when the API runs with COOKIE_SECURE=true). It does
// not validate it; the API is the authority. A stale cookie gets through here, the first API call
// answers 401, and the fetch wrapper sends the user to /login?expired=1. Redirecting on a stale
// cookie here instead would loop (/login would bounce back to the app).
// It never redirects away from /login for the same reason: the login page asks /me itself.
const COOKIES = ["session_token", "__Host-session_token"];
const PUBLIC = ["/login", "/design"];

// /api/* is forwarded to the backend HERE (not in next.config rewrites, which cannot add request
// headers). The browser only talks to the Next origin, so the session cookie is first-party and no
// CORS is needed. The backend sees Vercel as the socket peer, so with PROXY_SECRET set we also send
// the visitor's IP (Vercel's x-real-ip, which a client cannot forge) in X-Talaan-Client-IP, next to
// the secret that makes the backend believe it. Client-sent copies of both are always dropped, so
// nobody can name their own IP. BACKEND_URL and PROXY_SECRET are read per request (runtime env).
// Without PROXY_SECRET (local dev) neither header is sent and the backend uses the socket address.
const CLIENT_IP_HEADER = "x-talaan-client-ip";
const PROXY_SECRET_HEADER = "x-talaan-proxy-secret";

function forwardToApi(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const backend = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/+$/, "");
  const headers = new Headers(request.headers);
  headers.delete(CLIENT_IP_HEADER);
  headers.delete(PROXY_SECRET_HEADER);
  const secret = process.env.PROXY_SECRET?.trim();
  const ip = request.headers.get("x-real-ip")?.trim();
  if (secret && ip) {
    headers.set(CLIENT_IP_HEADER, ip);
    headers.set(PROXY_SECRET_HEADER, secret);
  }
  return NextResponse.rewrite(new URL(`${backend}${pathname}${search}`), { request: { headers } });
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/api" || pathname.startsWith("/api/")) return forwardToApi(request);
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (COOKIES.some((name) => request.cookies.has(name))) return NextResponse.next();

  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

// /api is matched on purpose (forwardToApi above); it needs no cookie guard because the backend
// answers 401 itself.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)"],
};
