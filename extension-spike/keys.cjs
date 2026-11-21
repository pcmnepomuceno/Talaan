// SPIKE ONLY. Generates two RSA keys (private halves only under SPIKE_SCRATCH, never in the repo),
// writes each public key (base64 SPKI) into ours/ and other/ manifest.json, prints the derived IDs.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SCRATCH = process.env.SPIKE_SCRATCH || "/tmp/claude-1000/-home-pcmnepomuceno-dev-Talaan/73866a80-8465-431d-a76d-58fff70dc969/scratchpad";
const KEYS = path.join(SCRATCH, "keys");

// Extension ID: first 32 hex chars of SHA-256(input), each hex digit 0-f mapped to a-p.
const toId = (buf) => [...crypto.createHash("sha256").update(buf).digest("hex").slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
const idFromPath = (dir) => toId(Buffer.from(dir)); // unpacked extension without "key"

function ensureKeys() {
  fs.mkdirSync(KEYS, { recursive: true, mode: 0o700 });
  const ids = {};
  for (const name of ["ours", "other"]) {
    const priv = path.join(KEYS, `${name}.pem`);
    let privateKey;
    if (fs.existsSync(priv)) privateKey = crypto.createPrivateKey(fs.readFileSync(priv));
    else {
      privateKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
      fs.writeFileSync(priv, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    }
    const der = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
    const mf = path.join(__dirname, name, "manifest.json");
    const m = JSON.parse(fs.readFileSync(mf, "utf8"));
    m.key = der.toString("base64");
    fs.writeFileSync(mf, JSON.stringify(m, null, 2) + "\n");
    ids[name] = toId(der);
  }
  return ids;
}

module.exports = { ensureKeys, idFromPath, toId, SCRATCH };
if (require.main === module) console.log(ensureKeys());
