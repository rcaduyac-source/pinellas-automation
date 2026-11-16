const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../quickbase/pages/permits/rules.js");

const P = R.F.permit, K = R.F.task;

test("checklist has 28 requirements with unique PR- ids", () => {
  assert.equal(R.REQS.length, 28);
  const ids = new Set(R.REQS.map((r) => r.id));
  assert.equal(ids.size, 28);
  for (const id of ids) assert.match(id, /^PR-[RHM]\d{2}$/);
});

test("job types map onto the checklist", () => {
  assert.equal(R.reqsFor("Reconstruction").length, 10);
  assert.equal(R.reqsFor("Rehabilitation").length, 9);
  assert.equal(R.reqsFor("MHU").length, 9);
  assert.equal(R.awardType("Rehab"), "Rehabilitation");
  assert.equal(R.awardType("recon"), "Reconstruction");
  assert.equal(R.awardType("Mobile Home"), "MHU");
  assert.equal(R.reqsFor("Home Elevation").length, 0);
  assert.equal(R.reqsFor("").length, 0);
});

test("requirement state round-trips through the task Status", () => {
  for (const st of R.REQ_STATES) assert.equal(R.stateOf(R.STATUS_OF[st]), st);
  assert.equal(R.stateOf(""), "Needed");
});

test("new requirement row carries the shared Florida Assignments keys", () => {
  const req = R.REQS.find((r) => r.id === "PR-R06");
  const out = R.requirementRecord({ req, state: "Received", jobRid: 2308, existing: null, date: "2026-11-16", who: "Test User" });
  const rec = out.record;
  assert.equal(rec[3], undefined);
  assert.equal(rec[K.job], 2308);
  assert.equal(rec[K.templateId], "PR-R06");
  assert.equal(rec[K.workflow], "FL-ASSIGN-1");
  assert.equal(rec[K.genKey], "2308|PR-R06");
  assert.equal(rec[K.status], "Complete");
  assert.equal(rec[K.completed], "2026-11-16");
  assert.equal(rec[K.basis], "When: Lot in an A or V flood zone");
});

test("Not needed needs a reason and appends it to the notes", () => {
  const req = R.REQS[0];
  assert.ok(R.requirementRecord({ req, state: "Not needed", note: " ", jobRid: 1, date: "2026-11-16" }).error);
  const out = R.requirementRecord({ req, state: "Not needed", note: "program supplies plans", jobRid: 1,
    existing: { rid: 55, notes: "older line" }, date: "2026-11-16", who: "A B" });
  assert.equal(out.record[3], 55);
  assert.equal(out.record[K.status], "N/A");
  assert.equal(out.record[K.notes], "older line\n2026-11-16 A B: program supplies plans");
  assert.equal(out.record[K.job], undefined);
});

test("back to Needed clears the completed date", () => {
  const out = R.requirementRecord({ req: R.REQS[0], state: "Needed", jobRid: 1, existing: { rid: 9, notes: "" }, date: "2026-11-16" });
  assert.equal(out.record[K.completed], "");
  assert.equal(out.record[K.status], "Not Started");
  assert.equal(out.record[K.notes], undefined);
});

const choices = { types: ["Building", "Roofing"], statuses: ["Not Started", "Submitted", "Issued", "Voided"] };

test("permit form is checked before saving", () => {
  const bad = R.permitRecord({ type: "Plumbing", status: "Done", submitted: "11/2/2026", fee: "abc" }, { choices, jobRid: 1 });
  assert.equal(bad.errors.length, 4);
  assert.ok(R.permitRecord({ type: "" }, { choices, jobRid: 1 }).errors.length);
});

test("new permit links the job; edit carries the record id; dates clear with empty string", () => {
  const add = R.permitRecord({ type: "Roofing", fee: "$1,250.50", paidDate: "2026-11-10" }, { choices, jobRid: 2308 });
  assert.deepEqual(add.errors, []);
  assert.equal(add.record[P.job], 2308);
  assert.equal(add.record[3], undefined);
  assert.equal(add.record[P.status], "Not Started");
  assert.equal(add.record[P.fee], 1250.5);
  assert.equal(add.record[P.paid], true);
  assert.equal(add.record[P.submitted], "");
  const edit = R.permitRecord({ type: "Building", status: "Issued", fee: "" }, { choices, permitRid: 77 });
  assert.equal(edit.record[3], 77);
  assert.equal(edit.record[P.job], undefined);
  assert.equal(edit.record[P.fee], "");
});

test("empty choice lists accept any value", () => {
  assert.deepEqual(R.permitRecord({ type: "Anything", status: "Whatever" }, { choices: { types: [], statuses: [] }, jobRid: 1 }).errors, []);
});

test("void keeps the row, needs a reason, and restore sets Not Started", () => {
  assert.ok(R.voidRecord({ permitRid: 5, reason: "", notes: "", date: "2026-11-16" }).error);
  const v = R.voidRecord({ permitRid: 5, reason: "no roof work", notes: "x", date: "2026-11-16", who: "A B" }).record;
  assert.equal(v[3], 5);
  assert.equal(v[P.status], "Voided");
  assert.equal(v[P.notes], "x\n2026-11-16 A B: does not apply — no roof work");
  const r = R.voidRecord({ permitRid: 5, undo: true, notes: "", date: "2026-11-16" }).record;
  assert.equal(r[P.status], "Not Started");
  assert.equal(r[P.notes], "2026-11-16: restored (applies again)");
});

test("a checklist file is found by its description prefix", () => {
  const desc = R.docDescription({ docType: "Habitat Permit Form", note: "signed", who: "A B", date: "2026-11-16" });
  assert.equal(desc, "Habitat Permit Form — signed. Uploaded by A B on 2026-11-16 (Pinellas Permits page).");
  const withPermit = R.docDescription({ docType: "Fee receipt", permit: { type: "Roofing", rid: 12 }, date: "2026-11-16" });
  assert.equal(withPermit, "Fee receipt · Roofing permit (#12). Uploaded on 2026-11-16 (Pinellas Permits page).");
  const docs = [{ description: desc }, { description: "Other thing" }];
  assert.equal(R.filedFor(docs, "Habitat Permit Form").length, 1);
});
