import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApi, NetworkError } from "../src/api.js";
import { API_BASE, TAB_QUERY } from "../src/config.js";

const BASE = "https://api.example.test";
const res = (status, data, type = "basic") => ({ status, type, json: async () => data });
const abortAware = (_url, init) =>
  new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("config", () => {
  it("pins the production API base and a one-line tab query", () => {
    expect(API_BASE).toBe("https://talaan-phi.vercel.app");
    expect(TAB_QUERY).toEqual({ active: true, currentWindow: true });
  });
});

describe("createApi requests", () => {
  it("me() is a credentialed GET without a body", async () => {
    const fetch = vi.fn(async () => res(200, { id: 1 }));
    const out = await createApi({ fetch, base: BASE }).me();
    expect(out).toEqual({ status: 200, data: { id: 1 } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/me`);
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.redirect).toBe("manual");
    expect(init.headers).toEqual({ Accept: "application/json" });
    expect(init.body).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("lookup(url) posts {url, exclude_id: null}", async () => {
    const fetch = vi.fn(async () => res(200, { match: null }));
    await createApi({ fetch, base: BASE }).lookup("https://x.example/j");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/applications/lookup`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ url: "https://x.example/j", exclude_id: null });
  });

  it("create(body) posts the body as JSON", async () => {
    const fetch = vi.fn(async () => res(201, { id: 3 }));
    const out = await createApi({ fetch, base: BASE }).create({ company: "A" });
    expect(out).toEqual({ status: 201, data: { id: 3 } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/applications`);
    expect(JSON.parse(init.body)).toEqual({ company: "A" });
  });

  it("returns status and null data for non-JSON bodies, never throwing", async () => {
    const fetch = vi.fn(async () => ({
      status: 502,
      type: "basic",
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }));
    expect(await createApi({ fetch, base: BASE }).me()).toEqual({ status: 502, data: null });
  });

  it("returns 401 as a result, not an error", async () => {
    const fetch = vi.fn(async () => res(401, { detail: "Not authenticated" }));
    expect((await createApi({ fetch, base: BASE }).me()).status).toBe(401);
  });

  it("clears its timer after a response", async () => {
    const fetch = vi.fn(async () => res(200, {}));
    await createApi({ fetch, base: BASE }).me();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("createApi failures", () => {
  it("a rejected fetch becomes NetworkError", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(createApi({ fetch, base: BASE }).me()).rejects.toBeInstanceOf(NetworkError);
  });

  it("an opaque redirect becomes NetworkError", async () => {
    const fetch = vi.fn(async () => res(0, null, "opaqueredirect"));
    await expect(createApi({ fetch, base: BASE }).me()).rejects.toBeInstanceOf(NetworkError);
  });

  it("status 0 becomes NetworkError", async () => {
    const fetch = vi.fn(async () => res(0, null));
    await expect(createApi({ fetch, base: BASE }).create({})).rejects.toBeInstanceOf(NetworkError);
  });

  it("aborts after 45000 ms by default, not before", async () => {
    const api = createApi({ fetch: vi.fn(abortAware), base: BASE });
    let settled = false;
    const p = api.me().then(
      () => (settled = "ok"),
      (e) => (settled = e),
    );
    await vi.advanceTimersByTimeAsync(44999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBeInstanceOf(NetworkError);
  });

  it("honours a custom timeoutMs", async () => {
    const api = createApi({ fetch: vi.fn(abortAware), base: BASE, timeoutMs: 100 });
    const p = api.lookup("https://x.example/");
    const assertion = expect(p).rejects.toBeInstanceOf(NetworkError);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
});
