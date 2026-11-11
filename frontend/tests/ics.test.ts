import { describe, expect, it } from "vitest";
import { buildIcs, icsFileName } from "../src/lib/ics";
import type { AgendaInterview } from "../src/lib/types";

const NOW = new Date("2026-11-10T01:02:03Z");
const ORIGIN = "https://t.example";

const make = (rest: Partial<AgendaInterview> = {}): AgendaInterview => ({
  id: 7,
  job_application_id: 12,
  interviewer: "Ana Santos",
  scheduled_at: "2026-11-20T14:00:00+08:00",
  mode: "online",
  outcome: "pending",
  remarks: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  company: "Pinagsama Tech",
  job_name: "Frontend Engineer",
  ...rest,
});

const ics = (i = make(), now = NOW, origin = ORIGIN) => {
  const out = buildIcs(i, { now, origin });
  if (out === null) throw new Error("expected a file");
  return out;
};
const unfold = (s: string) => s.replace(/\r\n /g, "");
const lines = (s: string) => s.split("\r\n");
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("buildIcs", () => {
  it("gives the exact file for a sample (one fold in DESCRIPTION)", () => {
    expect(ics()).toBe(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Talaan//Interviews//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        "UID:talaan-interview-7@talaan",
        "DTSTAMP:20261110T010203Z",
        "DTSTART:20261120T060000Z",
        "DTEND:20261120T070000Z",
        "SUMMARY:Interview: Frontend Engineer at Pinagsama Tech",
        "DESCRIPTION:Mode: Online\\nInterviewer: Ana Santos\\nApplication: https://t.e",
        " xample/applications/12",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
  });

  it("writes the PHT instant as UTC whatever the device zone is", () => {
    const original = process.env.TZ;
    try {
      const outs: string[] = [];
      const offsets = new Set<number>();
      for (const tz of ["UTC", "Pacific/Auckland", "America/Los_Angeles"]) {
        process.env.TZ = tz;
        offsets.add(new Date(2026, 10, 20, 12).getTimezoneOffset());
        outs.push(ics());
      }
      expect(offsets.size).toBe(3); // the switch took effect
      expect(new Set(outs).size).toBe(1);
      expect(outs[0]).toContain("DTSTART:20261120T060000Z\r\n");
      expect(outs[0]).toContain("DTEND:20261120T070000Z\r\n");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("accepts any offset and crosses midnight for the end", () => {
    const out = ics(make({ scheduled_at: "2026-11-20T23:30:00Z" }));
    expect(out).toContain("DTSTART:20261120T233000Z\r\n");
    expect(out).toContain("DTEND:20261121T003000Z\r\n");
  });

  it("returns null for a date it cannot read", () => {
    expect(buildIcs(make({ scheduled_at: "not a date" }), { now: NOW, origin: ORIGIN })).toBeNull();
  });

  it("uses CRLF for every line break and ends with one", () => {
    const out = ics(make({ company: "A\nB", job_name: "x\r\ny" }));
    expect(out.endsWith("\r\n")).toBe(true);
    expect(out).not.toMatch(/(?<!\r)\n/);
    expect(out).not.toMatch(/\r(?!\n)/);
  });

  it("escapes backslash, comma, semicolon and newlines, and leaves quotes", () => {
    const out = unfold(ics(make({ company: 'Back\\slash, Inc; "Q"', job_name: "one\ntwo" })));
    expect(out).toContain('SUMMARY:Interview: one\\ntwo at Back\\\\slash\\, Inc\\; "Q"');
  });

  it("folds at 75 octets without splitting a character (Filipino names, emoji)", () => {
    const company = "Niño Dela Peña-Ñañez Consulting 🚀 ".repeat(3).trim();
    const job = "Senior Inhinyero ng Software 🧑‍💻 ".repeat(8).trim(); // well over 300 chars
    const out = ics(make({ company, job_name: job, interviewer: "Ma. Kristína Réyes 😀".repeat(5) }));
    for (const l of lines(out)) {
      expect(bytes(l)).toBeLessThanOrEqual(75);
      expect(l.isWellFormed()).toBe(true); // no half of a surrogate pair
    }
    for (const l of lines(out).filter((x) => x.startsWith(" "))) expect(bytes(l)).toBeLessThanOrEqual(75);
    const flat = unfold(out);
    expect(flat).toContain(`SUMMARY:Interview: ${job} at ${company}`);
    expect(out.split("\r\n SUMMARY").length).toBe(1); // a fold never starts a property
  });

  it("keeps the UID stable per interview, independent of time and origin", () => {
    const a = ics(make(), new Date("2026-01-01T00:00:00Z"), "https://a.example");
    const b = ics(make(), new Date("2027-01-01T00:00:00Z"), "https://b.example");
    const uid = (s: string) => lines(s).find((l) => l.startsWith("UID:"));
    expect(uid(a)).toBe("UID:talaan-interview-7@talaan");
    expect(uid(b)).toBe(uid(a));
    expect(uid(ics(make({ id: 8 })))).toBe("UID:talaan-interview-8@talaan");
  });

  it("never includes the notes", () => {
    expect(ics(make({ remarks: "SECRET NOTES, private" }))).not.toMatch(/SECRET|private/);
  });

  it("omits the interviewer line when there is none, and names async", () => {
    const flat = unfold(ics(make({ interviewer: null, mode: "async" })));
    expect(flat).toContain("DESCRIPTION:Mode: Async\\nApplication: https://t.example/applications/12");
    expect(flat).not.toContain("Interviewer");
  });
});

describe("icsFileName", () => {
  it("is talaan-interview-<company-slug>-<PHT date>.ics", () => {
    expect(icsFileName(make())).toBe("talaan-interview-pinagsama-tech-2026-11-20.ics");
  });

  it("uses the PHT date, not the UTC one, around midnight", () => {
    expect(icsFileName(make({ scheduled_at: "2026-11-20T23:30:00+08:00" }))).toContain("-2026-11-20.ics");
    expect(icsFileName(make({ scheduled_at: "2026-11-21T00:30:00+08:00" }))).toContain("-2026-11-21.ics");
  });

  it("strips accents and unsafe characters", () => {
    expect(icsFileName(make({ company: "Peña & Co. / Ünï: \"x\"" }))).toBe("talaan-interview-pena-co-uni-x-2026-11-20.ics");
    expect(icsFileName(make({ company: "../../etc/passwd" }))).toBe("talaan-interview-etc-passwd-2026-11-20.ics");
  });

  it("falls back to 'company' and caps the slug", () => {
    expect(icsFileName(make({ company: "🚀🚀" }))).toBe("talaan-interview-company-2026-11-20.ics");
    const long = icsFileName(make({ company: "abcdefghij ".repeat(20) }));
    const slug = long.slice("talaan-interview-".length, -"-2026-11-20.ics".length);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("copes with an unreadable date", () => {
    expect(icsFileName(make({ scheduled_at: "nope" }))).toBe("talaan-interview-pinagsama-tech.ics");
  });
});


describe("control characters (review round 1, finding 2)", () => {
  // One of each class RFC 5545 3.3.11 forbids in TEXT: C0 below TAB, VT, FF, C0 after CR, DEL.
  const CTRL = ["\u0000", "\u0001", "\u0008", "\u000b", "\u000c", "\u000e", "\u001b", "\u001f", "\u007f"];
  const hostile = (c: string) => make({ company: `Ac${c}me`, job_name: `De${c}v`, interviewer: `An${c}a` });

  it.each(CTRL.map((c) => [c.codePointAt(0)!.toString(16).padStart(4, "0"), c]))("U+%s is stripped from SUMMARY and DESCRIPTION", (_, c) => {
    const out = ics(hostile(c));
    // The only control bytes left are the CRLF line ends (TAB is allowed but never produced here).
    expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(out)).toBe(false);
    expect(out.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const u = unfold(out);
    expect(u).toContain("SUMMARY:Interview: Dev at Acme\r\n");
    expect(u).toContain("Interviewer: Ana\\n");
  });

  it("a long name full of control characters still folds at 75 octets and keeps line breaks escaped", () => {
    const junk = Array.from({ length: 300 }, (_, k) => CTRL[k % CTRL.length] + "é").join("");
    const out = ics(make({ company: junk, job_name: "a\r\nb", interviewer: junk }));
    for (const l of lines(out)) expect(bytes(l)).toBeLessThanOrEqual(75);
    expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(out)).toBe(false);
    expect(unfold(out)).toContain("SUMMARY:Interview: a\\nb at " + "é".repeat(300));
  });

  it("the file name never carries one", () => {
    for (const c of CTRL) expect(icsFileName(hostile(c))).toBe("talaan-interview-acme-2026-11-20.ics");
  });
});
