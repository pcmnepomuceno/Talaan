import { NextRequest } from "next/server";
import { getRedirectUrl, getRewrittenUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "../src/proxy";

const call = (path: string, cookie?: string) =>
  proxy(new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : undefined));
const redirect = (path: string, cookie?: string) => getRedirectUrl(call(path, cookie));

describe("proxy", () => {
  it("redirects a private path without a cookie, keeping path and query in next", () => {
    expect(redirect("/applications?status=saved")).toBe(
      "http://localhost:3000/login?next=%2Fapplications%3Fstatus%3Dsaved",
    );
    expect(redirect("/account")).toBe("http://localhost:3000/login?next=%2Faccount");
  });

  it("lets either cookie name through", () => {
    expect(redirect("/applications", "session_token=abc")).toBeNull();
    expect(redirect("/applications", "__Host-session_token=abc")).toBeNull();
  });

  it("ignores unrelated cookies", () => {
    expect(redirect("/applications", "theme=dark")).not.toBeNull();
  });

  it("never redirects /login, with or without a cookie (stale cookie must not loop)", () => {
    expect(redirect("/login")).toBeNull();
    expect(redirect("/login?expired=1&next=%2Faccount")).toBeNull();
    expect(redirect("/login", "session_token=stale")).toBeNull();
  });

  it("leaves /design public", () => {
    expect(redirect("/design")).toBeNull();
  });

});

describe("matcher", () => {
  const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });
  it("runs on pages", () => {
    expect(runs("/applications")).toBe(true);
    expect(runs("/login")).toBe(true);
  });
  it("runs on /api (it owns the rewrite to the backend)", () => {
    for (const url of ["/api/v1/me", "/api/v1/login", "/api/v1/account/delete"]) {
      expect(runs(url)).toBe(true);
    }
  });
  it("skips _next assets and public files", () => {
    for (const url of [
      "/_next/static/x.js",
      "/_next/image",
      "/icon.svg",
      "/favicon.ico",
    ]) {
      expect(runs(url)).toBe(false);
    }
  });
});

describe("api forwarding", () => {
  const SECRET = "s".repeat(32);
  const CLIENT = "x-talaan-client-ip";
  const PROOF = "x-talaan-proxy-secret";
  // Vercel sets VERCEL=1 itself; the forwarding tests run as on Vercel unless they say otherwise.
  beforeEach(() => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("TRUST_X_REAL_IP", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const request = (headers: Record<string, string> = {}, path = "/api/v1/login?a=1") =>
    new NextRequest(`http://localhost:3000${path}`, { headers });
  const api = (headers: Record<string, string> = {}, path = "/api/v1/login?a=1") => proxy(request(headers, path));
  // A fresh copy of the module, so its once-per-process warning flags start clear.
  const freshProxy = async () => {
    vi.resetModules();
    return (await import("../src/proxy")).proxy;
  };
  // What the backend will receive: Next lists the request headers it forwards in
  // x-middleware-override-headers and prefixes each value with x-middleware-request-.
  const upstream = (res: Response, name: string) =>
    (res.headers.get("x-middleware-override-headers") ?? "").split(",").includes(name)
      ? res.headers.get(`x-middleware-request-${name}`)
      : null;

  it("rewrites /api to BACKEND_URL (read at call time), keeping path and query", () => {
    vi.stubEnv("BACKEND_URL", "https://api.example.com/");
    expect(getRewrittenUrl(api())).toBe("https://api.example.com/api/v1/login?a=1");
  });

  it("defaults BACKEND_URL to localhost:8000", () => {
    vi.stubEnv("BACKEND_URL", "");
    expect(getRewrittenUrl(api())).toBe("http://localhost:8000/api/v1/login?a=1");
  });

  it("does not need a session cookie on /api (the API answers 401 itself)", () => {
    expect(getRedirectUrl(api())).toBeNull();
  });

  it("with the secret set, sends the visitor IP from x-real-ip plus the secret", () => {
    vi.stubEnv("PROXY_SECRET", SECRET);
    const res = api({ "x-real-ip": "198.51.100.7" });
    expect(upstream(res, CLIENT)).toBe("198.51.100.7");
    expect(upstream(res, PROOF)).toBe(SECRET);
  });

  it("strips client-sent copies of both headers, with the secret set", () => {
    vi.stubEnv("PROXY_SECRET", SECRET);
    const res = api({ "x-real-ip": "198.51.100.7", [CLIENT]: "6.6.6.6", [PROOF]: "guess" });
    expect(upstream(res, CLIENT)).toBe("198.51.100.7");
    expect(upstream(res, PROOF)).toBe(SECRET);
  });

  it("strips client-sent copies of both headers, with the secret unset", () => {
    vi.stubEnv("PROXY_SECRET", "");
    const res = api({ "x-real-ip": "198.51.100.7", [CLIENT]: "6.6.6.6", [PROOF]: "guess" });
    expect(upstream(res, CLIENT)).toBeNull();
    expect(upstream(res, PROOF)).toBeNull();
  });

  it("sends the secret without an IP header when x-real-ip is missing (so the API warns)", () => {
    vi.stubEnv("PROXY_SECRET", SECRET);
    const res = api({ [CLIENT]: "6.6.6.6" });
    expect(upstream(res, CLIENT)).toBeNull();
    expect(upstream(res, PROOF)).toBe(SECRET);
  });

  describe("x-real-ip trust", () => {
    it("off the platform (VERCEL unset, no opt-in) sends neither header, even with a spoofed x-real-ip", () => {
      vi.stubEnv("VERCEL", "");
      vi.stubEnv("PROXY_SECRET", SECRET);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = api({ "x-real-ip": "6.6.6.6", [CLIENT]: "6.6.6.6", [PROOF]: "guess" });
      expect(upstream(res, CLIENT)).toBeNull();
      expect(upstream(res, PROOF)).toBeNull();
    });

    it("TRUST_X_REAL_IP=true opts in without VERCEL", () => {
      vi.stubEnv("VERCEL", "");
      vi.stubEnv("TRUST_X_REAL_IP", "true");
      vi.stubEnv("PROXY_SECRET", SECRET);
      const res = api({ "x-real-ip": "198.51.100.7" });
      expect(upstream(res, CLIENT)).toBe("198.51.100.7");
      expect(upstream(res, PROOF)).toBe(SECRET);
    });

    it("TRUST_X_REAL_IP=0 stays off", () => {
      vi.stubEnv("VERCEL", "");
      vi.stubEnv("TRUST_X_REAL_IP", "0");
      vi.stubEnv("PROXY_SECRET", SECRET);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = api({ "x-real-ip": "198.51.100.7" });
      expect(upstream(res, CLIENT)).toBeNull();
      expect(upstream(res, PROOF)).toBeNull();
    });

    it("warns once per process when the secret is set but x-real-ip is not trusted, never printing the secret", async () => {
      vi.stubEnv("VERCEL", "");
      vi.stubEnv("PROXY_SECRET", SECRET);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fresh = await freshProxy();
      fresh(request({ "x-real-ip": "198.51.100.7" }));
      fresh(request({ "x-real-ip": "198.51.100.8" }));
      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0].join(" ");
      expect(message).toMatch(/VERCEL=1/);
      expect(message).toMatch(/TRUST_X_REAL_IP=true/);
      expect(message).not.toContain(SECRET);
    });

    it("does not warn when PROXY_SECRET is unset", async () => {
      vi.stubEnv("VERCEL", "");
      vi.stubEnv("PROXY_SECRET", "");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fresh = await freshProxy();
      fresh(request({ "x-real-ip": "198.51.100.7" }));
      fresh(request());
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it("keeps the other request headers (cookie, origin)", () => {
    vi.stubEnv("PROXY_SECRET", SECRET);
    const res = api({ "x-real-ip": "198.51.100.7", cookie: "session_token=abc", origin: "http://localhost:3000" });
    expect(upstream(res, "cookie")).toBe("session_token=abc");
    expect(upstream(res, "origin")).toBe("http://localhost:3000");
  });
});
