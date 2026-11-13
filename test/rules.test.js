const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const R = require("../quickbase/pages/job-setup/rules.js");

const PROGRAMS = ["Pinellas Recovers Program", "Elevate Florida"];
const sample = (f) => fs.readFileSync(path.join(__dirname, "..", "samples", f), "utf8");
const load = (text) => {
  const t = R.readTemplate(R.parseCSV(text));
  assert.equal(t.ok, true, t.error);
  return R.checkRows(t.rows, { programs: PROGRAMS });
};

test("CSV parser handles quotes, commas, newlines, BOM and CRLF", () => {
  const rows = R.parseCSV('﻿a,"b, c","say ""hi"""\r\n"line\nbreak",x,\r\n');
  assert.deepEqual(rows, [["a", "b, c", 'say "hi"'], ["line\nbreak", "x", ""]]);
});

test("blank template round-trips and has no data rows", () => {
  const t = R.readTemplate(R.parseCSV(R.templateCSV()));
  assert.equal(t.ok, true);
  assert.equal(t.rows.length, 0);
});

test("good sample: every row passes and values are cleaned", () => {
  const out = load(sample("jobs-sample.csv"));
  assert.equal(out.length, 3);
  for (const r of out) assert.deepEqual(r.errors, [], `row ${r.rowNumber}: ${r.errors}`);
  const [a, b] = out;
  assert.equal(a.rowNumber, 3, "data starts on spreadsheet line 3");
  assert.equal(a.data.state, "Florida");
  assert.equal(a.data.status, "OPEN");
  assert.equal(a.data.price, 182948.52);
  assert.equal(a.data.ownerPhone, "(727) 555-0101");
  assert.equal(a.data.caseId, "PC-HRRP-900001");
  assert.equal(b.data.jobType, "Rehabilitation", "Rehab alias");
  assert.ok(b.warnings.some((w) => w.includes("saved as")));
});

test("broken sample: each bad row says what is wrong", () => {
  const out = load(sample("jobs-broken.csv"));
  const errs = Object.fromEntries(out.map((r) => [r.rowNumber, r.errors.join(" | ")]));
  assert.match(errs[3], /Job Name is required/);
  assert.match(errs[4], /Job Type "Bungalow"/);
  assert.match(errs[5], /Program "Pinellas Recovery"/);
  assert.match(errs[6], /Zip "3468"/);
  assert.match(errs[6], /State "Floridaa"/);
  assert.match(errs[7], /Original Contract Price "about 100k"/);
  assert.match(errs[7], /Phone Number "555-01"/);
  assert.match(errs[8], /Email "not-an-email"/);
  assert.match(errs[9], /Same case PC-HRRP-900010 as row 8/);
  assert.match(errs[10], /Status "Pending"/);
});

test("columns are matched by label, so order doesn't matter", () => {
  const csv = "Email,Job Name,Job Type,Program,Address - Street 1,Address - City,Address - Zip,Address - State,Status,Original Contract Price,Homeowner Name,Phone Number\n" +
    "a@b.co,PC-HRRP-1234- MHU- 1 Main St- A B,MHU,Pinellas Recovers Program,1 Main St,Largo,33771,FL,,,A B,\n";
  const [r] = load(csv);
  assert.deepEqual(r.errors, []);
  assert.equal(r.data.ownerEmail, "a@b.co");
});

test("missing column is reported by name", () => {
  const t = R.readTemplate(R.parseCSV("Job Name,Job Type,Program\nx,MHU,y\n"));
  assert.equal(t.ok, false);
  assert.match(t.error, /Address - Street 1/);
});

test("jobs already in Quickbase are blocked by exact name or same case id", () => {
  const out = load(sample("jobs-sample.csv"));
  R.markExisting(out, [{ rid: 2308, name: "PC-HRRP-900001- MHU- something else- Someone" }]);
  assert.match(out[0].errors.join(), /Already in Quickbase: job #2308/);
  assert.deepEqual(out[1].errors, []);
});

test("records carry the right field ids", () => {
  const [r] = load(sample("jobs-sample.csv"));
  const job = R.jobRecord(r.data, { ownerRid: 77, programRid: 53 });
  assert.equal(job[6].value, r.data.jobName);
  assert.equal(job[11].value, "Florida");
  assert.equal(job[197].value, 77);
  assert.equal(job[1814].value, 53);
  const owner = R.ownerRecord(r.data);
  assert.equal(owner[6].value, r.data.ownerName);
  assert.equal(owner[13].value, "Florida");
  assert.equal(owner[14].value, r.data.zip);
});
