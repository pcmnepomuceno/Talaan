// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, errorMessage, request, safeNext } from "../src/lib/http";

function reply(status: number, body?: unknown, headers: Record<string, string> = {}) {
  const init = { status, headers };
  const res = body === undefined ? new Response(null, init) : new Response(typeof body === "string" ? body : JSON.stringify(body), init);
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(res);
}

const replaceMock = vi.fn();
beforeEach(() => {
  replaceMock.mockClear();
  vi.stubGlobal("location", { pathname: "/account", search: "?x=1", replace: replaceMock });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("request", () => {
  it("returns parsed JSON and sends same-origin JSON", async () => {
    const f = reply(200, { id: 1 });
    expect(await request("/api/v1/me")).toEqual({ id: 1 });
    const [path, init] = f.mock.calls[0];
    expect(path).toBe("/api/v1/me");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.method).toBe("GET");
  });

  it("sends a JSON body with a content type", async () => {
    const f = reply(200, {});
    await request("/api/v1/login", { method: "POST", body: { a: 1 } });
    const init = f.mock.calls[0][1]!;
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("204 resolves to undefined", async () => {
    reply(204);
    expect(await request("/api/v1/logout", { method: "POST" })).toBeUndefined();
  });

  it("a 2xx that is not JSON throws a status 0 error (retryable message), not undefined", async () => {
    reply(200, "<html>proxy error page</html>", { "Content-Type": "text/html" });
    const e = await request("/api/v1/me").catch((err) => err);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(0);
    expect(errorMessage(e)).toBe("Talaan isn't responding right now. Try again in a moment.");
  });

  it("an empty 200 body also throws", async () => {
    reply(200);
    expect(await request("/api/v1/me").catch((err) => err)).toBeInstanceOf(ApiError);
  });

  it("throws status and detail on 4xx", async () => {
    reply(403, { detail: "Incorrect password." });
    const e = await request("/x", { method: "POST" }).catch((err) => err);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(403);
    expect(e.detail).toBe("Incorrect password.");
  });

  it("tolerates a non-JSON error body", async () => {
    reply(502, "<html>bad gateway</html>");
    const e = await request("/x").catch((err) => err);
    expect(e.status).toBe(502);
    expect(typeof e.detail).toBe("string");
  });

  it("network failure is status 0", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const e = await request("/x").catch((err) => err);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(0);
  });

  it("maps a 422 detail list to field names, without the pydantic prefix", async () => {
    reply(422, {
      detail: [
        { loc: ["body", "password"], msg: "Value error, Password must contain at least one digit." },
        { loc: ["body", "email"], msg: "value is not a valid email address" },
        { loc: ["body", "password"], msg: "second message ignored" },
      ],
    });
    const e = await request("/x", { method: "POST" }).catch((err) => err);
    expect(e.status).toBe(422);
    expect(e.fieldErrors).toEqual({
      password: "Password must contain at least one digit.",
      email: "value is not a valid email address",
    });
  });

  it("reads Retry-After as seconds", async () => {
    reply(429, { detail: "Too many attempts. Try again later." }, { "Retry-After": "125" });
    const e = await request("/x", { method: "POST" }).catch((err) => err);
    expect(e.retryAfterSeconds).toBe(125);
  });

  it("401 redirects to login with the current path and never settles", async () => {
    reply(401, { detail: "Not authenticated" });
    const settled = vi.fn();
    request("/api/v1/me").then(settled, settled);
    await vi.waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(replaceMock).toHaveBeenCalledWith("/login?expired=1&next=%2Faccount%3Fx%3D1");
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).not.toHaveBeenCalled();
  });

  it("401 with redirectOn401: false throws instead", async () => {
    reply(401, { detail: "Invalid email or password." });
    const e = await request("/x", { method: "POST", redirectOn401: false }).catch((err) => err);
    expect(e.status).toBe(401);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("401 on the login page throws instead of looping", async () => {
    vi.stubGlobal("location", { pathname: "/login", search: "", replace: replaceMock });
    reply(401, { detail: "Not authenticated" });
    const e = await request("/api/v1/me").catch((err) => err);
    expect(e.status).toBe(401);
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

describe("errorMessage", () => {
  const err = (status: number, retry: number | null = null) => new ApiError(status, "x", {}, retry);
  it("429 rounds up to minutes", () => {
    expect(errorMessage(err(429, 61))).toBe("Too many attempts. Try again in about 2 minutes.");
    expect(errorMessage(err(429, 60))).toBe("Too many attempts. Try again in about 1 minute.");
    expect(errorMessage(err(429, 3))).toBe("Too many attempts. Try again in about 1 minute.");
    expect(errorMessage(err(429, 900))).toBe("Too many attempts. Try again in about 15 minutes.");
  });
  it("429 without Retry-After", () => {
    expect(errorMessage(err(429))).toBe("Too many attempts. Try again later.");
  });
  it("network and 5xx are retryable", () => {
    const text = "Talaan isn't responding right now. Try again in a moment.";
    expect(errorMessage(err(0))).toBe(text);
    expect(errorMessage(err(503))).toBe(text);
    expect(errorMessage(err(502))).toBe(text);
  });
  it("403 is a blocked request (the Origin check), never a credentials error", () => {
    expect(errorMessage(err(403))).toBe("This request was blocked. Reload the page and try again.");
  });
  it("other statuses are left to the caller", () => {
    expect(errorMessage(err(401))).toBeNull();
    expect(errorMessage(err(422))).toBeNull();
  });
});

describe("safeNext", () => {
  it.each(["/applications", "/applications/3?status=saved", "/account"])("accepts %s", (p) => {
    expect(safeNext(p)).toBe(p);
  });
  it.each([
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "",
    null,
    undefined,
    "applications",
    "/a\nb",
    "/a\u0000b",
    "/a\u007fb",
    "/login?next=x",
    "/login",
  ])("rejects %j", (p) => {
    expect(safeNext(p as string | null | undefined)).toBe("/applications");
  });
});
