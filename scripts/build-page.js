/*
 * Builds dist/<page>.html for every folder in quickbase/pages/ that has a page.html.
 *
 *   node scripts/build-page.js                    all pages, needs QB_APP_TOKEN (env or .env)
 *   node scripts/build-page.js --preview          leaves the token placeholder, for local preview
 *   node scripts/build-page.js permits            one page (folder name)
 *
 * Each page.html holds three placeholders:
 *   SHIM  -> quickbase/pages/shared/shim.js (QB-SESSION-SHIM, token filled in here)
 *   RULES -> the page's rules.js (pure logic, tested in test/)
 *   APP   -> the page's app.js (page behaviour and Quickbase calls)
 *
 * The app token only ever lands in dist/, which Git ignores.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const pagesDir = path.join(root, "quickbase", "pages");
const args = process.argv.slice(2);
const preview = args.includes("--preview");
const only = args.filter((a) => !a.startsWith("--"));

function token() {
  if (process.env.QB_APP_TOKEN) return process.env.QB_APP_TOKEN;
  const envFile = path.join(root, ".env");
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, "utf8").match(/^QB_APP_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

let shim = fs.readFileSync(path.join(pagesDir, "shared", "shim.js"), "utf8");
if (!preview) {
  const t = token();
  if (!t) { console.error("QB_APP_TOKEN not set (env or .env). Use --preview for a local build."); process.exit(1); }
  shim = shim.replace("__QB_APP_TOKEN__", t);
}

const pages = fs.readdirSync(pagesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(pagesDir, d.name, "page.html")))
  .map((d) => d.name)
  .filter((name) => !only.length || only.includes(name));
if (!pages.length) { console.error(`No page found${only.length ? ` named ${only.join(", ")}` : ""}.`); process.exit(1); }

for (const name of pages) {
  const read = (f) => fs.readFileSync(path.join(pagesDir, name, f), "utf8");
  // Function replacers so "$" in the sources is never treated as a pattern.
  const html = read("page.html")
    .replace("/*@@SHIM@@*/", () => shim)
    .replace("/*@@RULES@@*/", () => read("rules.js"))
    .replace("/*@@APP@@*/", () => read("app.js"));

  if (/@@(SHIM|RULES|APP)@@/.test(html)) { console.error(`${name}: a placeholder was not replaced.`); process.exit(1); }

  const out = path.join(root, "dist", preview ? `${name}.preview.html` : `${name}.html`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`Built ${path.relative(root, out)} (${(html.length / 1024).toFixed(1)} KB${preview ? ", preview, no token" : ""})`);
}
