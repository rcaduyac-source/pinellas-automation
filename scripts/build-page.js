/*
 * Builds dist/job-setup.html from quickbase/pages/job-setup/.
 *
 *   node scripts/build-page.js            needs QB_APP_TOKEN (env or .env)
 *   node scripts/build-page.js --preview  leaves the token placeholder, for local preview
 *
 * The app token only ever lands in dist/, which Git ignores.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const src = path.join(root, "quickbase", "pages", "job-setup");
const preview = process.argv.includes("--preview");

function token() {
  if (process.env.QB_APP_TOKEN) return process.env.QB_APP_TOKEN;
  const envFile = path.join(root, ".env");
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, "utf8").match(/^QB_APP_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

const read = (f) => fs.readFileSync(path.join(src, f), "utf8");
let shim = read("shim.js");
if (!preview) {
  const t = token();
  if (!t) { console.error("QB_APP_TOKEN not set (env or .env). Use --preview for a local build."); process.exit(1); }
  shim = shim.replace("__QB_APP_TOKEN__", t);
}

// Function replacers so "$" in the sources is never treated as a pattern.
const html = read("page.html")
  .replace("/*@@SHIM@@*/", () => shim)
  .replace("/*@@RULES@@*/", () => read("rules.js"))
  .replace("/*@@APP@@*/", () => read("app.js"));

if (/@@(SHIM|RULES|APP)@@/.test(html)) { console.error("A placeholder was not replaced."); process.exit(1); }

const out = path.join(root, "dist", preview ? "job-setup.preview.html" : "job-setup.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Built ${path.relative(root, out)} (${(html.length / 1024).toFixed(1)} KB${preview ? ", preview, no token" : ""})`);
