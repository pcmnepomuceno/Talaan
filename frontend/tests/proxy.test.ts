import { NextRequest } from "next/server";
import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
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

  it("never redirects /api/*, with or without a cookie", () => {
    for (const path of ["/api/v1/me", "/api/v1/login", "/api/v1/account/delete"]) {
      expect(redirect(path)).toBeNull();
      expect(redirect(path, "session_token=abc")).toBeNull();
    }
  });
});

describe("matcher", () => {
  const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });
  it("runs on pages", () => {
    expect(runs("/applications")).toBe(true);
    expect(runs("/login")).toBe(true);
  });
  it("skips /api, _next assets and public files", () => {
    for (const url of ["/api/v1/me", "/_next/static/x.js", "/_next/image", "/icon.svg", "/favicon.ico"]) {
      expect(runs(url)).toBe(false);
    }
  });
});
