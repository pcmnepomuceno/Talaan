// Local seed: signs up a throwaway account and creates sample applications and interviews through the
// API (via the Next origin, so the rewrite is exercised). NOT in package.json or CI.
//
//   NODE_PATH=<dir containing playwright> node scripts/seed-applications.cjs
//
// Run directly it starts the stack on the TEST database (scripts/local-env.cjs), seeds, prints the
// login, and keeps running until Ctrl-C, then cleans up (stops servers, truncates the test database,
// proves the dev database and :8000 were untouched). screens-applications.cjs imports seedAccount().
const { request } = require("playwright");
const { withEnv } = require("./local-env.cjs");

const PASSWORD = "Passw0rd!seed";

const GENERIC_STATUSES = ["applied", "screening", "interviewing", "offered", "rejected", "withdrawn", "ghosted", "saved", "accepted"];
const MODES = ["on_site", "hybrid", "remote"];

// Created last, so they are the newest and show at the top of the list.
const HAND = [
  { company: "Haraya Solutions International Holdings and Technology Services Philippines", job_name: "Senior Principal Staff Software Engineer, Platform Reliability and Developer Experience Tooling", status: "rejected", mode_of_work: "hybrid", salary: 120000, date_applied: "2026-10-02", contact_website: "https://haraya.example.ph/careers/senior-principal-staff-software-engineer", remarks: "Take-home test, then a panel. " + "Very long note line that should wrap cleanly on a narrow screen. ".repeat(6) },
  { company: "株式会社ひかり", job_name: "フロントエンドエンジニア 🚀", status: "applied", mode_of_work: "remote", salary: null, date_applied: "2026-10-30", contact_website: null, remarks: null },
  { company: "Kalayaan Logistics", job_name: "Operations Analyst", status: "saved", mode_of_work: "remote", salary: 50000, date_applied: null, contact_website: "https://kalayaan.example.ph", remarks: "Apply after the holidays." },
  { company: "Mayon Software Labs", job_name: "Full Stack Developer", status: "screening", mode_of_work: "on_site", salary: 0, date_applied: "2026-10-19", contact_website: null, remarks: null },
  { company: "Bayanihan Digital", job_name: "Product Designer", status: "offered", mode_of_work: "remote", salary: 95000, date_applied: "2026-09-28", contact_website: "https://bayanihan.example.ph/careers", remarks: "Verbal offer on Oct 28.\nWaiting for the written contract." },
  { company: "Pinagsama Tech", job_name: "Frontend Engineer", status: "interviewing", mode_of_work: "hybrid", salary: 85000, date_applied: "2026-10-14", contact_website: "https://pinagsama.example.ph", remarks: "Referred by a former teammate.\nAsk about the team size.", interviews: [
    { scheduled_at: "2026-10-24T14:00:00+08:00", mode: "online", outcome: "pending", interviewer: "Mark Rivera", remarks: null },
    { scheduled_at: "2026-10-18T10:00:00+08:00", mode: "online", outcome: "good", interviewer: "Ana Santos", remarks: "Portfolio walkthrough." },
    { scheduled_at: "2026-10-21T23:30:00+08:00", mode: "async", outcome: "bad", interviewer: null, remarks: "Take-home challenge, late-night deadline." },
  ] },
];

/** Signs up and seeds; returns the credentials and what was created. */
async function seedAccount({ base, invite, email = `seed-${Date.now()}@example.com`, name = "Ana Cruz", generic = 50, hand = true }) {
  const ctx = await request.newContext({ baseURL: base });
  const must = async (res, what) => {
    if (!res.ok()) throw new Error(`${what} failed: ${res.status()} ${await res.text()}`);
    return res.status() === 204 ? null : res.json();
  };
  await must(await ctx.post("/api/v1/signup", { data: { email, password: PASSWORD, account_name: name, invite_code: invite } }), "signup");
  await must(await ctx.post("/api/v1/login", { data: { email, password: PASSWORD } }), "login");
  let apps = 0;
  let interviews = 0;
  for (let i = 1; i <= generic; i++) {
    await must(
      await ctx.post("/api/v1/applications", {
        data: {
          company: `Sample Company ${String(i).padStart(2, "0")}`,
          job_name: `Sample Role ${String(i).padStart(2, "0")}`,
          status: GENERIC_STATUSES[i % GENERIC_STATUSES.length],
          mode_of_work: MODES[i % 3],
          salary: i % 4 === 0 ? null : 30000 + i * 1000,
          date_applied: i % 9 === 8 ? null : `2026-09-${String((i % 28) + 1).padStart(2, "0")}`,
        },
      }),
      "create application",
    );
    apps++;
  }
  for (const { interviews: ivs = [], ...body } of hand ? HAND : []) {
    const row = await must(await ctx.post("/api/v1/applications", { data: body }), "create application");
    apps++;
    for (const iv of ivs) {
      await must(await ctx.post(`/api/v1/applications/${row.id}/interviews`, { data: iv }), "create interview");
      interviews++;
    }
  }
  await ctx.dispose();
  return { email, password: PASSWORD, apps, interviews };
}

module.exports = { seedAccount, PASSWORD };

if (require.main === module) {
  withEnv(async ({ base, createInvite }) => {
    const r = await seedAccount({ base, invite: createInvite("f5 seed") });
    console.log(`seeded ${r.apps} applications and ${r.interviews} interviews`);
    console.log(`open ${base}/login  email: ${r.email}  password: ${r.password}`);
    console.log("Ctrl-C to stop (servers stop, test database is truncated).");
    await new Promise(() => {});
  }).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
