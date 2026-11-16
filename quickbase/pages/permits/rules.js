/*
 * Permits — the Pinellas permit checklist and the rules for saving permits.
 *
 * Pure functions only: no network, no DOM. The same file runs in the
 * Quickbase page (as a global, PermitRules) and in Node tests (require).
 *
 * Ported from the Florida Assignments app (byrdson-fl-assignments, Permits tab,
 * Nov 13-14, 2026). Both write the SAME Quickbase rows, so a change made on
 * either side shows on the other:
 *   - checklist state  -> PreConstruction Activities (bv68x62x6), one row per
 *                         requirement, Template ID = PR-xxx, Workflow Version FL-ASSIGN-1
 *   - documents        -> Attachments (buskqh28a), Category - Job = "Permits"
 *   - permits          -> US Permits (bu5cvf3js)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PermitRules = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var T = {
    jobs: "buskqh27b",
    tasks: "bv68x62x6",        // PreConstruction Activities
    attachments: "buskqh28a",
    permits: "bu5cvf3js"       // US Permits
  };

  // Field ids.
  var F = {
    job: { name: 6, address: 7, street: 8, city: 10, zip: 12, type: 34, status: 35, program: 490 },
    task: { templateId: 6, group: 7, name: 8, role: 9, status: 12, completed: 14, notes: 15, job: 17, basis: 24, workflow: 42, genKey: 44 },
    att: { file: 10, description: 16, name: 20, job: 21, drive: 23, category: 53, created: 1 },
    permit: { type: 6, submitted: 7, approved: 8, number: 9, status: 10, expires: 11, file: 12, job: 15, notes: 19, title: 36, fee: 46, paid: 47, paidDate: 48 }
  };

  // Same tag the Florida Assignments app uses, so both apps share the rows.
  var WORKFLOW = "FL-ASSIGN-1";
  var REQ_GROUP = "8. Permit requirements";
  var DOC_CATEGORY = "Permits";
  var SOURCE = "Pinellas Permits page";

  var DOC_TYPES = [
    "Permit application", "Site plan", "Survey", "Engineering / plans", "Homeowner-signed documents", "Fee receipt",
    "Reviewer comments", "Comment response", "Issued permit", "Inspection result", "Notice of Commencement", "Other"
  ];

  /*
   * Pinellas Recovers permit requirements by job type, from the team's
   * "Pinellas Recovers Permit Requirements Check.xlsx" (sheet "Permit", 2026-11-13).
   *   check  = the sheet's Status (is the requirement confirmed by the sources)
   *   listed = "On Our List?" (was it on Byrdson's list before the check)
   *   when   = the condition from the sheet's Action Needed; "" = every job of the type
   */
  function r(id, type, name, check, listed, who, action, sources, source, when) {
    return { id: id, type: type, name: name, check: check, listed: listed, who: who, action: action, sources: sources, source: source, when: when || "" };
  }
  var REQS = [
    // Reconstruction
    r("PR-R01", "Reconstruction", "Plans and specifications", "Not confirmed", true, "GC (sealed by architect or engineer)", "Confirm with the program whether it supplies plans. If not, the GC gets sealed plans.", "Guidelines assign engineering design to the GC (§10.2). County requires structural plans digitally signed and sealed by an architect or engineer.", "Program Guidelines / County Residential Permits"),
    r("PR-R02", "Reconstruction", "Boundary or topographic survey", "Not confirmed", true, "GC (survey sub)", "Change the owner from Program to GC. Make sure the survey is less than 5 years old.", "Guidelines assign boundary surveys to the GC (§10.2). County requires a survey issued within the last 5 years; outdated surveys are not accepted for new construction.", "Program Guidelines / County Permitting Guide"),
    r("PR-R03", "Reconstruction", "Notice of Commencement recorded with the Clerk", "Confirmed", true, "GC (homeowner signs)", "None.", "Required for building work over $5,000. Recorded with the Clerk of the Circuit Court, attached at submittal, and kept on site for every inspection.", "County Permitting Guide / County NOC Page"),
    r("PR-R04", "Reconstruction", "Energy calculations (with HVAC sizing and blower door test)", "Partly", true, "Energy consultant or designer", "Remove \"from licensed engineer.\" Add HVAC sizing calculations and the blower door test.", "County asks for signed energy forms and HVAC sizing calculations. No engineer requirement is stated. A blower door test notice is on the county forms list.", "County Permitting Guide / County Forms List"),
    r("PR-R05", "Reconstruction", "Subcontractor form (electrical, mechanical, plumbing)", "Confirmed", true, "GC", "Confirm the sub registration rule with county licensing.", "Required before permit issuance on multi-trade permits. Every contractor must be listed to call in trade inspections. The page does not state the registration rule.", "County Subcontractor Form"),
    r("PR-R06", "Reconstruction", "Flood Zone Application", "Missing", false, "GC", "Add for lots in A or V flood zones.", "Required for new construction in A and V zones.", "County Permitting Guide / County Forms List", "Lot in an A or V flood zone"),
    r("PR-R07", "Reconstruction", "Elevation certificates (lowest floor 2 ft above BFE)", "Missing", false, "Program orders where needed; surveyor", "Add. Confirm whether the program or Byrdson orders them.", "Homes in the 1% or 0.2% floodplain must have the lowest floor at least 2 ft above Base Flood Elevation (§11.2).", "Program Guidelines", "Home in the 1% or 0.2% floodplain"),
    r("PR-R08", "Reconstruction", "Habitat Permit Form", "Missing", false, "GC", "Add.", "Required when new construction or exterior work is proposed.", "County Permitting Guide / County Forms List"),
    r("PR-R09", "Reconstruction", "Right-of-Way Utilization Form", "Missing", false, "GC", "Add when the job has driveway, sewer or water work in the county right-of-way.", "Required for work in county right-of-way, such as new or replacement driveways and sewer or water connections.", "County Permitting Guide", "Driveway, sewer or water work in the county right-of-way"),
    r("PR-R10", "Reconstruction", "Health Department no-objection letter", "Missing", false, "GC", "Add when the lot is on septic.", "Required for properties on septic.", "County Permitting Guide", "Lot on septic"),
    // Rehabilitation
    r("PR-H01", "Rehabilitation", "Survey", "Partly", true, "GC (survey sub)", "Order through the GC only when the permit calls for one.", "Guidelines assign surveys to the GC (§10.2). County survey requirements vary by permit type.", "Program Guidelines / County Permitting Guide", "Only when the permit calls for one"),
    r("PR-H02", "Rehabilitation", "Elevation certificate", "Partly", true, "Program orders where needed", "Confirm whether the program or Byrdson orders it.", "Needed in flood zones. Guidelines say the program orders elevation certificates where needed (§11.2).", "Program Guidelines / County Substantial Damage Page", "Home in a flood zone"),
    r("PR-H03", "Rehabilitation", "Rehabilitation plan (existing and proposed)", "Confirmed", true, "GC", "None.", "County requires plans showing existing and proposed conditions. Structural work needs sealed plans.", "County Permitting Guide / County Residential Permits"),
    r("PR-H04", "Rehabilitation", "Roofing permit with Re-Roofing Affidavit", "Confirmed", true, "Roofing sub", "Add the county Re-Roofing Affidavit.", "Roofing is a listed program permit type (§10.5). The county forms list includes a Re-Roofing Affidavit.", "Program Guidelines / County Forms List", "Roof work in the scope"),
    r("PR-H05", "Rehabilitation", "Notice of Commencement", "Missing", false, "GC (homeowner signs)", "Add.", "Required for building work over $5,000 and mechanical changeouts over $15,000.", "County Permitting Guide / County NOC Page", "Building work over $5,000 or mechanical changeout over $15,000"),
    r("PR-H06", "Rehabilitation", "Substantial Improvement Disclosure Form", "Missing", false, "GC (homeowner signs)", "Add for homes in a flood zone.", "Required when the FEMA 50% rule applies.", "County Permitting Guide / County Substantial Damage Page", "Home in a flood zone"),
    r("PR-H07", "Rehabilitation", "FEMA cost breakdown worksheet", "Missing", false, "GC", "Add for homes in a flood zone.", "The county Substantial Improvement Cost Breakdown worksheet supports the 50% rule review.", "County Forms List / County Substantial Damage Page", "Home in a flood zone"),
    r("PR-H08", "Rehabilitation", "Subcontractor form", "Missing", false, "GC", "Add when more than one trade is on the permit.", "Required for permits with multiple trades, before the permit is issued.", "County Subcontractor Form", "More than one trade on the permit"),
    r("PR-H09", "Rehabilitation", "Florida product approvals", "Missing", false, "GC", "Add for roofing, windows and doors.", "County intake lists the Florida Product Approval list as a submittal item.", "County Permitting Guide", "Roofing, windows or doors in the scope"),
    // MHU
    r("PR-M01", "MHU", "Boundary and topographic survey", "Partly", true, "Survey sub", "Confirm with the county before ordering one.", "County intake asks for a survey or plot plan. Guidelines say replacements are not likely to need boundary surveys and are reviewed case by case (§10.2).", "Program Guidelines / County Permitting Guide", "Only if the county asks"),
    r("PR-M02", "MHU", "MHU plans, pier and foundation details, installation manual", "Confirmed", true, "Manufacturer", "None.", "Rule 15C-1 requires setup to follow the manufacturer's installation instructions. Program units must be HUD certified (§9.5.1).", "Rule 15C-1.0102 / Program Guidelines"),
    r("PR-M03", "MHU", "Penetrometer test (soil bearing)", "Confirmed", true, "Licensed MHU installer", "Confirm which form Pinellas wants.", "Standard Florida setup test under Rule 15C-1, done by a licensed installer. Pinellas does not post its own MHU checklist.", "15C-1 Worksheet Example / Rule 15C-1.0102"),
    r("PR-M04", "MHU", "Torque probe test", "Confirmed", true, "Licensed MHU installer", "Confirm which form Pinellas wants.", "Standard Florida setup test under Rule 15C-1. On 15C-1 worksheets, a reading of 275 inch-pounds or less requires 5 ft anchors.", "15C-1 Worksheet Example"),
    r("PR-M05", "MHU", "MHU installer license + county installer registration", "Confirmed", true, "MHU installer", "Add the county installer registration.", "Installer must be licensed by Florida DHSMV. Pinellas also requires installers to register with county licensing (state license, liability and workers' comp certificates, ID).", "Rule 15C-2.0073 / County Permitting Guide"),
    r("PR-M06", "MHU", "Notice of Commencement", "Missing", false, "GC (homeowner signs)", "Add.", "Required for building work over $5,000.", "County Permitting Guide / County NOC Page"),
    r("PR-M07", "MHU", "Final elevation certificate", "Missing", false, "Surveyor", "Add for units in the 100-year floodplain.", "Program requires a final elevation certificate showing the lowest finished floor 2 ft or more above BFE (§11.5.3).", "Program Guidelines", "Unit in the 100-year floodplain"),
    r("PR-M08", "MHU", "Flood Zone Application", "Missing", false, "GC", "Confirm with the county whether an MHU setup in a flood zone needs it.", "County requires it for new construction in A and V zones.", "County Permitting Guide / County Forms List", "Flood zone A or V (confirm with the county)"),
    r("PR-M09", "MHU", "Subcontractor form", "Missing", false, "GC", "Add when electrical or plumbing hookups go to separate subs.", "Required for permits with multiple trades, before the permit is issued.", "County Subcontractor Form", "Electrical or plumbing hookups by separate subs")
  ];

  function norm(s) { return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " "); }

  /** The checklist's job type for a Quickbase Job Type ("" when the checklist has none for it). */
  function awardType(raw) {
    var s = norm(raw);
    if (!s) return "";
    if (s === "mhu" || s.indexOf("mobile") > -1 || s.indexOf("manufactured") > -1) return "MHU";
    if (s.indexOf("rehab") === 0) return "Rehabilitation";
    if (s.indexOf("recon") === 0) return "Reconstruction";
    return "";
  }
  function reqsFor(jobType) {
    var t = awardType(jobType);
    return REQS.filter(function (x) { return x.type === t; });
  }

  /** Per job, each requirement is Needed (default), Received or Not needed, stored as the task row's Status. */
  var REQ_STATES = ["Needed", "Received", "Not needed"];
  var STATUS_OF = { "Needed": "Not Started", "Received": "Complete", "Not needed": "N/A" };
  function stateOf(status) { return status === "Complete" ? "Received" : status === "N/A" ? "Not needed" : "Needed"; }

  function today(d) {
    d = d || new Date();
    // Florida (Eastern) calendar day, so a late-evening save is dated correctly.
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d); }
    catch (e) { return d.toISOString().slice(0, 10); }
  }
  function appendNote(existing, line) {
    return [String(existing || "").trim(), String(line || "").trim()].filter(Boolean).join("\n");
  }
  function noteLine(date, who, text) { return date + (who ? " " + who : "") + ": " + text; }

  /**
   * The task-row fields for setting a requirement's state on a job.
   * existing = the job's task row for this requirement ({rid, notes}) or null (a new row is made).
   */
  function requirementRecord(o) {
    var def = o.req, f = F.task;
    if (REQ_STATES.indexOf(o.state) < 0) return { error: "Unknown state." };
    if (o.state === "Not needed" && !String(o.note || "").trim()) return { error: "Say why it is not needed." };
    var rec = {};
    rec[f.status] = STATUS_OF[o.state];
    rec[f.completed] = o.state === "Needed" ? "" : o.date;
    var line = String(o.note || "").trim() ? noteLine(o.date, o.who, String(o.note).trim()) : "";
    if (line) rec[f.notes] = appendNote(o.existing && o.existing.notes, line);
    if (o.existing) { rec[3] = o.existing.rid; return { record: rec }; }
    rec[f.job] = o.jobRid;
    rec[f.templateId] = def.id;
    rec[f.group] = REQ_GROUP;
    rec[f.name] = def.name;
    rec[f.role] = def.who;
    rec[f.workflow] = WORKFLOW;
    rec[f.genKey] = o.jobRid + "|" + def.id;
    rec[f.basis] = def.when ? "When: " + def.when : "Every job of this type";
    return { record: rec };
  }

  var ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

  /**
   * Checks an edit / add form for one US Permits row and returns the record to save.
   * choices = { types: [...], statuses: [...] } from the table (empty list = anything goes).
   */
  function permitRecord(form, o) {
    var f = F.permit, errors = [];
    var types = (o.choices && o.choices.types) || [], statuses = (o.choices && o.choices.statuses) || [];
    var type = String(form.type || "").trim();
    var status = String(form.status || "").trim() || "Not Started";
    if (!type) errors.push("Pick a permit type.");
    else if (types.length && types.indexOf(type) < 0) errors.push("Pick a permit type from the list.");
    if (statuses.length && statuses.indexOf(status) < 0) errors.push("Pick a status from the list.");
    [["Submitted", form.submitted], ["Issued", form.approved], ["Expires", form.expires], ["Fee paid on", form.paidDate]].forEach(function (x) {
      if (x[1] && !ISO_DAY.test(x[1])) errors.push(x[0] + " is not a date.");
    });
    var feeRaw = String(form.fee == null ? "" : form.fee).replace(/[$,\s]/g, "");
    var fee = feeRaw === "" ? "" : Number(feeRaw);
    if (fee !== "" && (!isFinite(fee) || fee < 0)) errors.push("Fee must be an amount.");
    if (errors.length) return { errors: errors };
    var rec = {};
    // Quickbase date fields take "" (not null) to clear.
    rec[f.type] = type;
    rec[f.title] = String(form.title || "").trim();
    rec[f.status] = status;
    rec[f.number] = String(form.number || "").trim();
    rec[f.submitted] = form.submitted || "";
    rec[f.approved] = form.approved || "";
    rec[f.expires] = form.expires || "";
    rec[f.fee] = fee;
    rec[f.paid] = !!(form.paid || form.paidDate);
    rec[f.paidDate] = form.paidDate || "";
    rec[f.notes] = String(form.notes == null ? "" : form.notes);
    if (o.permitRid) rec[3] = o.permitRid; else rec[f.job] = o.jobRid;
    return { errors: [], record: rec };
  }

  /** "Does not apply to this job": the row is kept, set to Voided, with the reason in its notes. Restore sets it back to Not Started. */
  function voidRecord(o) {
    var f = F.permit;
    if (!o.undo && !String(o.reason || "").trim()) return { error: "Say why it does not apply." };
    var rec = {};
    rec[3] = o.permitRid;
    rec[f.status] = o.undo ? "Not Started" : "Voided";
    rec[f.notes] = appendNote(o.notes, noteLine(o.date, o.who, o.undo ? "restored (applies again)" : "does not apply — " + String(o.reason).trim()));
    return { record: rec };
  }

  /**
   * The Attachments description. A file for a checklist item starts with the
   * requirement's name, which is how the checklist finds its files.
   */
  function docDescription(o) {
    var permit = o.permit ? " · " + o.permit.type + " permit (#" + o.permit.rid + ")" : "";
    var note = String(o.note || "").trim() ? " — " + String(o.note).trim() : "";
    return (o.docType || "Document") + permit + note + ". Uploaded" + (o.who ? " by " + o.who : "") + " on " + o.date + " (" + SOURCE + ").";
  }
  function filedFor(docs, reqName) {
    var n = norm(reqName);
    return docs.filter(function (d) { return norm(d.description).indexOf(n) === 0; });
  }

  function permitTone(status) {
    if (/Voided/.test(status)) return "grey";
    if (/Issued|Approved|Active|Passed|Closed/.test(status)) return "ok";
    if (/Corrections|Expired/.test(status)) return "bad";
    if (/Submitted|Review|Prep|Pending|Scheduled/.test(status)) return "info";
    return "grey";
  }

  return {
    T: T, F: F, WORKFLOW: WORKFLOW, DOC_CATEGORY: DOC_CATEGORY, DOC_TYPES: DOC_TYPES, SOURCE: SOURCE,
    REQS: REQS, REQ_STATES: REQ_STATES, STATUS_OF: STATUS_OF,
    awardType: awardType, reqsFor: reqsFor, stateOf: stateOf, today: today, appendNote: appendNote,
    requirementRecord: requirementRecord, permitRecord: permitRecord, voidRecord: voidRecord,
    docDescription: docDescription, filedFor: filedFor, permitTone: permitTone
  };
});
