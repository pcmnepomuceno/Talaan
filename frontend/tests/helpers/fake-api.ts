// In-memory stand-in for the backend, installed over global fetch. It implements just enough of
// /api/v1/applications (paging, ?status=, newest first, PATCH merge, 404s) for screen tests.
import { vi } from "vitest";
import type { Application, Interview } from "../../src/lib/types";

export const STAMP = "2026-10-01T09:00:00+08:00";

export const makeApp = (id: number, rest: Partial<Application> = {}): Application => ({
  id,
  company: `Company ${id}`,
  job_name: `Job ${id}`,
  contact_website: null,
  contact_email: null,
  status: "applied",
  salary: null,
  mode_of_work: "remote",
  remarks: null,
  date_applied: "2026-10-14",
  created_at: new Date(Date.UTC(2026, 9, 1) + id * 60_000).toISOString(),
  updated_at: STAMP,
  ...rest,
});

export const makeInterview = (id: number, job_application_id: number, rest: Partial<Interview> = {}): Interview => ({
  id,
  job_application_id,
  interviewer: null,
  scheduled_at: "2026-10-18T10:00:00+08:00",
  mode: "online",
  outcome: "pending",
  remarks: null,
  created_at: STAMP,
  updated_at: STAMP,
  ...rest,
});

/** The five applications the old mock shipped with; many screen tests rely on them. */
export function seed(): { apps: Application[]; interviews: Interview[] } {
  return {
    apps: [
      makeApp(1, { company: "Pinagsama Tech", job_name: "Frontend Engineer", contact_website: "https://pinagsama.example.ph", status: "interviewing", salary: 85000, mode_of_work: "hybrid", remarks: "Referred by a former teammate.", date_applied: "2026-10-14" }),
      makeApp(2, { company: "Bayanihan Digital", job_name: "Product Designer", status: "offered", salary: 95000, date_applied: "2026-09-28" }),
      makeApp(3, { company: "Mayon Software Labs", job_name: "Full Stack Developer", status: "applied", mode_of_work: "on_site", date_applied: "2026-10-19" }),
      makeApp(4, { company: "Kalayaan Logistics", job_name: "Operations Analyst", status: "saved", salary: 50000, date_applied: null }),
      makeApp(5, { company: "Haraya Solutions", job_name: "Senior Staff Engineer", status: "rejected", salary: 120000, mode_of_work: "hybrid", date_applied: "2026-10-02" }),
    ],
    interviews: [
      makeInterview(1, 1, { scheduled_at: "2026-10-24T14:00:00+08:00", interviewer: "Mark Rivera" }),
      makeInterview(2, 1, { scheduled_at: "2026-10-18T10:00:00+08:00", outcome: "good", interviewer: "Ana Santos", remarks: "Portfolio walkthrough." }),
      makeInterview(3, 2, { scheduled_at: "2026-09-30T15:30:00+08:00", mode: "on_site", outcome: "good" }),
    ],
  };
}

type Call = { method: string; path: string; body: unknown };
type Override = { match: (c: Call) => boolean; respond: () => Response | Promise<Response>; once: boolean };

export const json = (status: number, body?: unknown, headers?: Record<string, string>) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

export function installFake(initial = seed()) {
  const db = { apps: initial.apps, interviews: initial.interviews, nextId: 1000 };
  const calls: Call[] = [];
  const overrides: Override[] = [];

  const sorted = (rows: Application[]) =>
    [...rows].sort((a, b) => (a.created_at === b.created_at ? b.id - a.id : a.created_at < b.created_at ? 1 : -1));

  async function handle(c: Call, url: URL): Promise<Response> {
    const p = url.pathname.replace("/api/v1", "");
    let m: RegExpMatchArray | null;
    if (p === "/applications" && c.method === "GET") {
      const status = url.searchParams.get("status");
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const rows = sorted(db.apps.filter((a) => !status || a.status === status));
      return json(200, { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset });
    }
    if (p === "/applications" && c.method === "POST") {
      const now = new Date(Date.UTC(2026, 11, 1) + db.nextId * 1000).toISOString();
      const row = { ...makeApp(db.nextId++), ...(c.body as object), contact_email: null, created_at: now, updated_at: now } as Application;
      db.apps.push(row);
      return json(201, row);
    }
    if ((m = p.match(/^\/applications\/(\d+)$/))) {
      const row = db.apps.find((a) => a.id === Number(m![1]));
      if (!row) return json(404, { detail: "Application not found." });
      if (c.method === "GET") return json(200, row);
      if (c.method === "PATCH") return json(200, Object.assign(row, c.body));
      if (c.method === "DELETE") {
        db.apps = db.apps.filter((a) => a !== row);
        db.interviews = db.interviews.filter((i) => i.job_application_id !== row.id);
        return json(204);
      }
    }
    if ((m = p.match(/^\/applications\/(\d+)\/interviews$/))) {
      const id = Number(m[1]);
      if (!db.apps.some((a) => a.id === id)) return json(404, { detail: "Application not found." });
      const rows = db.interviews.filter((i) => i.job_application_id === id).sort((a, b) => (a.scheduled_at < b.scheduled_at ? -1 : 1));
      const limit = Number(url.searchParams.get("limit") ?? 20);
      return json(200, { items: rows.slice(0, limit), total: rows.length, limit, offset: 0 });
    }
    return json(404, { detail: "Not Found" });
  }

  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const c: Call = {
      method: init?.method ?? "GET",
      path: url.pathname.replace("/api/v1", "") + url.search,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(c);
    const i = overrides.findIndex((o) => o.match(c));
    if (i !== -1) {
      const o = overrides[i];
      if (o.once) overrides.splice(i, 1);
      return o.respond();
    }
    return handle(c, url);
  });

  return {
    db,
    calls,
    spy,
    /** Answer calls matching method + path regex with `respond` (once by default). */
    on(method: string, path: RegExp, respond: () => Response | Promise<Response>, once = true) {
      overrides.push({ match: (c) => c.method === method && path.test(c.path), respond, once });
    },
    /** Make the next matching call fail with a server error. */
    failNext(method: string, path: RegExp, status = 500) {
      this.on(method, path, () => json(status, { detail: "Server error" }));
    },
    callsTo: (method: string, path: RegExp) => calls.filter((c) => c.method === method && path.test(c.path)),
  };
}

export type Fake = ReturnType<typeof installFake>;
