// Shared by the local Playwright scripts (e2e-applications, screens-applications, seed-applications).
// NOT part of package.json or CI. It starts, on free ports, everything a run needs and removes it again:
//   - the API (uvicorn, COOKIE_SECURE=false, generous rate limits) on the *_test database only,
//   - `next dev` with BACKEND_URL pointing at that API,
// then on exit (success, failure, Ctrl-C) it stops what it started, truncates the test database and
// prints proof that the dev database and any process it did not start were left alone.
//
// Needs: docker compose db running (`docker compose up -d db`), the test database created once
// (`docker compose exec db createdb -U talaan talaan_test`), the repo .venv, and Playwright resolvable
// from NODE_PATH (PW_CHROMIUM may point at a chromium binary).
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const REPO = path.resolve(__dirname, "../..");
const FRONTEND = path.resolve(__dirname, "..");
const PYTHON = process.env.PYTHON ?? path.join(REPO, ".venv/bin/python");
const LOGS = path.join(FRONTEND, ".screenshots/logs");

function readEnvFile() {
  const out = {};
  const file = path.join(REPO, ".env");
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** The test URL (TEST_DATABASE_URL, else DATABASE_URL + "_test") and the dev URL. Refuses anything not *_test. */
function databases() {
  const file = readEnvFile();
  const dev = process.env.DATABASE_URL || file.DATABASE_URL;
  if (!dev) throw new Error("DATABASE_URL not found in the environment or .env");
  const explicit = process.env.TEST_DATABASE_URL || file.TEST_DATABASE_URL;
  const test = explicit || dev.replace(/([^/?]+)(\?.*)?$/, "$1_test$2");
  const name = (u) => new URL(u.replace(/^[^:]+\+?[^:]*:/, "http:")).pathname.slice(1);
  if (!name(test).endsWith("_test")) throw new Error("test database name must end in _test");
  if (name(test) === name(dev)) throw new Error("test and dev database are the same");
  return { dev, test, devName: name(dev), testName: name(test) };
}

function sql(url, code) {
  return execFileSync(PYTHON, ["-I", "-c", code], { env: { ...process.env, URL: url }, encoding: "utf8", cwd: REPO }).trim();
}
const PY_HEAD = "import os\nfrom sqlalchemy import create_engine, text\ne = create_engine(os.environ['URL'])\n";

function counts(url) {
  return sql(url, PY_HEAD + "with e.connect() as c:\n  print(c.execute(text('select (select count(*) from users), (select count(*) from job_applications)')).one())");
}

function truncateAll(url) {
  return sql(
    url,
    PY_HEAD +
      "with e.begin() as c:\n  for (t,) in c.execute(text(\"select tablename from pg_tables where schemaname='public' and tablename<>'alembic_version'\")).all():\n    c.execute(text('TRUNCATE TABLE \"%s\" RESTART IDENTITY CASCADE' % t))\n  print(c.execute(text('select (select count(*) from users), (select count(*) from job_applications)')).one())",
  );
}

/** pid listening on the port, or null. */
function listener(port) {
  try {
    const out = execFileSync("ss", ["-ltnpH", `sport = :${port}`], { encoding: "utf8" });
    const m = out.match(/pid=(\d+)/);
    return out.trim() ? (m ? Number(m[1]) : -1) : null;
  } catch {
    return null;
  }
}

const isFree = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(listener(port) === null)));
  });

async function freePort(preferred) {
  for (let p = preferred; p < preferred + 200; p++) if (await isFree(p)) return p;
  throw new Error(`no free port from ${preferred}`);
}

async function waitFor(url, label, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not come up at ${url}`);
}

const killGroup = (child) => {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
};

/** Starts the stack, runs fn({base, apiBase, createInvite}), always cleans up, then prints the proof. */
async function withEnv(fn) {
  const db = databases();
  fs.mkdirSync(LOGS, { recursive: true });
  const foreign8000 = listener(8000); // not ours: only recorded
  const devBefore = counts(db.dev); // read-only SELECT on the dev database
  // E2E_API_PORT: start the search elsewhere to leave :8000 alone even when it is free (default 8000).
  const apiPort = await freePort(Number(process.env.E2E_API_PORT) || 8000);
  const webPort = await freePort(3000);
  const children = [];
  let cleaned = false;

  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    for (const c of children) killGroup(c);
    await new Promise((r) => setTimeout(r, 1500));
    for (const c of children) if (c.exitCode === null) try { process.kill(-c.pid, "SIGKILL"); } catch {}
    const left = truncateAll(db.test);
    const devAfter = counts(db.dev);
    console.log("\n--- cleanup ---");
    console.log(`stopped: API :${apiPort}, next dev :${webPort} (${children.length} processes started by this run)`);
    console.log(`test database ${db.testName} truncated; (users, job_applications) now ${left}`);
    console.log(`dev database ${db.devName} not written to: (users, job_applications) before ${devBefore}, after ${devAfter}: ${devBefore === devAfter ? "unchanged" : "CHANGED"}`);
    const after8000 = listener(8000);
    if (foreign8000 === null) console.log(`:8000: nothing was listening before; ${after8000 === null ? "nothing now" : "pid " + after8000 + " now (not started by this run)"}`);
    else console.log(`:8000: pid ${foreign8000} was already listening and was not started by this run; ${after8000 === foreign8000 ? "still the same pid, untouched" : "NOW DIFFERENT"}`);
    if (devBefore !== devAfter || (foreign8000 !== null && after8000 !== foreign8000)) process.exitCode = 1;
  }
  for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => cleanup().finally(() => process.exit(130)));

  try {
    console.log(`API port ${apiPort}${apiPort === 8000 ? "" : foreign8000 !== null ? ` (:8000 is busy, pid ${foreign8000}, not ours)` : " (E2E_API_PORT; :8000 left alone)"}; web port ${webPort}; test db ${db.testName}`);
    const baseEnv = { ...process.env, DATABASE_URL: db.test, TEST_DATABASE_URL: db.test };
    execFileSync(PYTHON, ["-m", "alembic", "upgrade", "head"], { cwd: REPO, env: baseEnv, stdio: "ignore" });

    const base = `http://localhost:${webPort}`;
    const apiBase = `http://localhost:${apiPort}`;
    const api = spawn(PYTHON, ["-m", "uvicorn", "app.main:app", "--port", String(apiPort), "--no-proxy-headers"], {
      cwd: REPO,
      detached: true,
      stdio: ["ignore", fs.openSync(path.join(LOGS, "api.log"), "w"), fs.openSync(path.join(LOGS, "api.log"), "a")],
      env: { ...baseEnv, COOKIE_SECURE: "false", TRUST_PROXY: "false", ALLOWED_ORIGINS: base, LOGIN_IP_LIMIT: "1000", LOGIN_EMAIL_LIMIT: "1000", SIGNUP_IP_LIMIT: "1000" },
    });
    children.push(api);
    const web = spawn("npx", ["next", "dev", "-p", String(webPort)], {
      cwd: FRONTEND,
      detached: true,
      stdio: ["ignore", fs.openSync(path.join(LOGS, "web.log"), "w"), fs.openSync(path.join(LOGS, "web.log"), "a")],
      env: { ...process.env, BACKEND_URL: apiBase, HIDE_DEV_INDICATOR: "1", NEXT_TELEMETRY_DISABLED: "1" },
    });
    children.push(web);
    await waitFor(`${apiBase}/ping`, "API");
    await waitFor(`${base}/login`, "next dev");

    const createInvite = (note = "f5 local") => {
      const out = execFileSync(PYTHON, ["-m", "app.admin", "create-invite", "--note", note, "--expires-in", "1d"], { cwd: REPO, env: baseEnv, encoding: "utf8" });
      const m = out.match(/TLN-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/);
      if (!m) throw new Error("no invite code in CLI output");
      return m[0];
    };
    return await fn({ base, apiBase, createInvite });
  } finally {
    await cleanup();
  }
}

function chromiumOptions() {
  return process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};
}

module.exports = { withEnv, chromiumOptions, REPO, FRONTEND };
