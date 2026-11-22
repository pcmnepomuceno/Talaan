// Thin fetch wrapper. Cookie session only: credentials "include", nothing stored.
// Returns { status, data } (data is parsed JSON or null). Anything that is not a real
// HTTP answer (reject, abort, opaque redirect) throws NetworkError.
export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = "NetworkError";
  }
}

export function createApi({ fetch, base, timeoutMs = 45000 }) {
  async function call(method, path, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const headers = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      let res;
      try {
        res = await fetch(base + path, {
          method,
          credentials: "include",
          redirect: "manual",
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ctl.signal,
        });
      } catch {
        throw new NetworkError("request failed");
      }
      if (res.type === "opaqueredirect" || res.status === 0) throw new NetworkError("redirected");
      let data = null;
      try {
        data = await res.json();
      } catch {
        if (ctl.signal.aborted) throw new NetworkError("timed out");
      }
      return { status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    me: () => call("GET", "/api/v1/me"),
    lookup: (url) => call("POST", "/api/v1/applications/lookup", { url, exclude_id: null }),
    create: (body) => call("POST", "/api/v1/applications", body),
  };
}
