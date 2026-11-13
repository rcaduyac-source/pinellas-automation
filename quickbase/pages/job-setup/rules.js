/*
 * Job Setup — reading and checking rules.
 *
 * Pure functions only: no network, no DOM. The same file runs in the
 * Quickbase page (as a global, JobRules) and in Node tests (require).
 *
 * The template ("Job Creation - Template.xlsx") has two header rows:
 *   row 1: "Field ID: 6", "Field ID: 34", ...   (Quickbase field ids)
 *   row 2: "Job Name", "Job Type", ...           (labels)
 * Columns A-I go to Jobs (buskqh27b). Columns J-L go to Owners (buskqh27m),
 * which is why field ids 6, 7 and 8 appear twice. Columns are matched by
 * their label, never by position.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JobRules = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var JOB_TYPES = [
    "Reconstruction", "Renovation", "Relocation", "Rehabilitation", "Repair",
    "New Construction", "MHU", "Home Elevation", "Acquisition & Demolition",
    "Demolition", "Modular Home", "Mitigation Reconstruction"
  ];
  // Short names the Pinellas team uses in job names ("PC-HRRP-...- Rehab- ...").
  var JOB_TYPE_ALIASES = { rehab: "Rehabilitation", recon: "Reconstruction", "mobile home": "MHU" };

  var STATUSES = ["OPEN", "COMPLETED", "INACTIVE", "ON-HOLD", "CANCELLED", "WITHDRAWN", "FOR BIDDING"];

  var STATES = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
    CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
    HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
    KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
    MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
    NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
    NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
    OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
    TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
    WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico"
  };

  // One entry per template column. `table` + `fid` say where the value lands.
  var COLUMNS = [
    { key: "jobName",    label: "Job Name",                table: "jobs",   fid: 6,  required: true },
    { key: "jobType",    label: "Job Type",                table: "jobs",   fid: 34, required: true },
    { key: "program",    label: "Program",                 table: "jobs",   fid: 490, required: true },
    { key: "street",     label: "Address - Street 1",      table: "jobs",   fid: 8,  required: true },
    { key: "city",       label: "Address - City",          table: "jobs",   fid: 10, required: true },
    { key: "zip",        label: "Address - Zip",           table: "jobs",   fid: 12, required: true },
    { key: "state",      label: "Address - State",         table: "jobs",   fid: 11, required: true },
    { key: "status",     label: "Status",                  table: "jobs",   fid: 35, required: false },
    { key: "price",      label: "Original Contract Price", table: "jobs",   fid: 41, required: false },
    { key: "ownerName",  label: "Homeowner Name",          table: "owners", fid: 6,  required: true },
    { key: "ownerPhone", label: "Phone Number",            table: "owners", fid: 7,  required: false },
    { key: "ownerEmail", label: "Email",                   table: "owners", fid: 8,  required: false }
  ];

  var FIELDS = {
    jobs: { relatedOwner: 197, programLink: 1814 },
    owners: { street: 10, city: 12, state: 13, zip: 14 }
  };

  function norm(s) { return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " "); }

  /* RFC 4180 CSV: quoted fields, doubled quotes, commas/newlines inside quotes, BOM, CRLF. */
  function parseCSV(text) {
    text = String(text || "").replace(/^﻿/, "");
    var rows = [], row = [], field = "", i = 0, q = false;
    while (i < text.length) {
      var c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { q = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function isBlankRow(r) { return !r || r.every(function (c) { return String(c).trim() === ""; }); }

  /*
   * Find the label row, map columns by label, return the data rows.
   * rowNumber is the line number people see in Excel/Sheets (1-based).
   */
  function readTemplate(rows) {
    var labelIdx = -1;
    for (var i = 0; i < Math.min(rows.length, 5); i++) {
      var hits = rows[i].filter(function (c) {
        return COLUMNS.some(function (col) { return norm(col.label) === norm(c); });
      }).length;
      if (hits >= 3) { labelIdx = i; break; }
    }
    if (labelIdx < 0) {
      return { ok: false, error: "This file doesn't look like the job template. The header row with \"Job Name\", \"Job Type\" and the other column names is missing." };
    }
    var header = rows[labelIdx], map = {}, missing = [];
    COLUMNS.forEach(function (col) {
      var at = header.findIndex(function (c) { return norm(c) === norm(col.label); });
      if (at < 0) missing.push(col.label); else map[col.key] = at;
    });
    if (missing.length) {
      return { ok: false, error: "These template columns are missing or renamed: " + missing.join(", ") + "." };
    }
    var data = [];
    for (var r = labelIdx + 1; r < rows.length; r++) {
      if (isBlankRow(rows[r])) continue;
      var raw = {};
      COLUMNS.forEach(function (col) { raw[col.key] = String(rows[r][map[col.key]] == null ? "" : rows[r][map[col.key]]).trim(); });
      data.push({ rowNumber: r + 1, raw: raw });
    }
    return { ok: true, rows: data };
  }

  function parseMoney(s) {
    var t = String(s).replace(/[$,\s]/g, "");
    if (t === "") return null;
    if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
    return Math.round(parseFloat(t) * 100) / 100;
  }

  function caseIdOf(jobName) {
    var m = String(jobName || "").toUpperCase().match(/^([A-Z]{2,}-[A-Z]+-\d{3,})/);
    return m ? m[1] : null;
  }

  /*
   * Check and clean one row.
   * ctx.programs: list of program names the page found in Quickbase (optional;
   * when missing, Program is only checked for being filled in).
   */
  function checkRow(row, ctx) {
    ctx = ctx || {};
    var raw = row.raw, d = {}, errors = [], warnings = [];

    COLUMNS.forEach(function (col) {
      if (col.required && raw[col.key] === "") errors.push(col.label + " is required.");
      d[col.key] = raw[col.key];
    });

    if (raw.jobType) {
      var jt = JOB_TYPES.find(function (t) { return norm(t) === norm(raw.jobType); }) || JOB_TYPE_ALIASES[norm(raw.jobType)];
      if (!jt) errors.push("Job Type \"" + raw.jobType + "\" isn't one of the allowed types.");
      else {
        if (norm(jt) !== norm(raw.jobType)) warnings.push("Job Type \"" + raw.jobType + "\" saved as \"" + jt + "\".");
        d.jobType = jt;
      }
    }

    if (raw.program && ctx.programs) {
      var pg = ctx.programs.find(function (p) { return norm(p) === norm(raw.program); });
      if (!pg) errors.push("Program \"" + raw.program + "\" isn't in the Programs table.");
      else d.program = pg;
    }

    if (raw.state) {
      var st = STATES[raw.state.toUpperCase()] ||
        Object.keys(STATES).map(function (k) { return STATES[k]; }).find(function (n) { return norm(n) === norm(raw.state); });
      if (!st) errors.push("State \"" + raw.state + "\" isn't a US state.");
      else d.state = st;
    }

    if (raw.zip && !/^\d{5}(-\d{4})?$/.test(raw.zip)) errors.push("Zip \"" + raw.zip + "\" should be 5 digits.");

    if (raw.status === "") d.status = "OPEN";
    else {
      var s = STATUSES.find(function (x) { return norm(x) === norm(raw.status); });
      if (!s) errors.push("Status \"" + raw.status + "\" isn't one of: " + STATUSES.join(", ") + ".");
      else d.status = s;
    }

    d.price = null;
    if (raw.price !== "") {
      var p = parseMoney(raw.price);
      if (isNaN(p) || p < 0) errors.push("Original Contract Price \"" + raw.price + "\" isn't a dollar amount.");
      else d.price = p;
    }

    if (raw.ownerPhone) {
      var digits = raw.ownerPhone.replace(/\D/g, "");
      if (digits.length === 11 && digits[0] === "1") digits = digits.slice(1);
      if (digits.length !== 10) errors.push("Phone Number \"" + raw.ownerPhone + "\" should have 10 digits.");
      else d.ownerPhone = "(" + digits.slice(0, 3) + ") " + digits.slice(3, 6) + "-" + digits.slice(6);
    }

    if (raw.ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.ownerEmail)) {
      errors.push("Email \"" + raw.ownerEmail + "\" doesn't look like an email address.");
    }
    d.ownerEmail = raw.ownerEmail.toLowerCase();

    if (!raw.ownerPhone && !raw.ownerEmail) warnings.push("No phone or email for the homeowner.");

    d.caseId = caseIdOf(raw.jobName);
    return { rowNumber: row.rowNumber, data: d, errors: errors, warnings: warnings };
  }

  /* Check every row, then flag the same job or case appearing twice in the file. */
  function checkRows(rows, ctx) {
    var out = rows.map(function (r) { return checkRow(r, ctx); });
    var seenName = {}, seenCase = {};
    out.forEach(function (r) {
      var n = norm(r.data.jobName);
      if (n) {
        if (seenName[n]) r.errors.push("Same Job Name as row " + seenName[n] + ".");
        else seenName[n] = r.rowNumber;
      }
      var c = r.data.caseId;
      if (c && !r.errors.some(function (e) { return e.indexOf("Same Job Name") === 0; })) {
        if (seenCase[c]) r.errors.push("Same case " + c + " as row " + seenCase[c] + ".");
        else seenCase[c] = r.rowNumber;
      }
    });
    return out;
  }

  /*
   * existing: [{rid, name}] jobs already in Quickbase that share a name or case id
   * with the file. Marks those rows as errors so they are never created twice.
   */
  function markExisting(checked, existing) {
    checked.forEach(function (r) {
      var n = norm(r.data.jobName), c = r.data.caseId;
      var hit = existing.find(function (e) { return norm(e.name) === n; }) ||
        (c && existing.find(function (e) { return caseIdOf(e.name) === c; }));
      if (hit) r.errors.push("Already in Quickbase: job #" + hit.rid + " (" + hit.name + ").");
    });
    return checked;
  }

  function jobRecord(d, links) {
    var rec = {};
    function put(fid, v) { if (v !== null && v !== undefined && v !== "") rec[fid] = { value: v }; }
    put(6, d.jobName); put(34, d.jobType); put(490, d.program);
    put(8, d.street); put(10, d.city); put(11, d.state); put(12, d.zip);
    put(35, d.status); put(41, d.price);
    if (links && links.ownerRid) put(FIELDS.jobs.relatedOwner, links.ownerRid);
    if (links && links.programRid) put(FIELDS.jobs.programLink, links.programRid);
    return rec;
  }

  /* The homeowner lives at the job address, so the owner gets the same address. */
  function ownerRecord(d) {
    var rec = {};
    function put(fid, v) { if (v !== null && v !== undefined && v !== "") rec[fid] = { value: v }; }
    put(6, d.ownerName); put(7, d.ownerPhone); put(8, d.ownerEmail);
    put(FIELDS.owners.street, d.street); put(FIELDS.owners.city, d.city);
    put(FIELDS.owners.state, d.state); put(FIELDS.owners.zip, d.zip);
    return rec;
  }

  /* A blank CSV with the same two header rows as the official template. */
  function templateCSV() {
    function cell(s) { return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    return [
      COLUMNS.map(function (c) { return "Field ID: " + c.fid; }).join(","),
      COLUMNS.map(function (c) { return cell(c.label); }).join(",")
    ].join("\r\n") + "\r\n";
  }

  return {
    COLUMNS: COLUMNS, JOB_TYPES: JOB_TYPES, JOB_TYPE_ALIASES: JOB_TYPE_ALIASES,
    STATUSES: STATUSES, STATES: STATES, FIELDS: FIELDS,
    parseCSV: parseCSV, readTemplate: readTemplate, checkRow: checkRow, checkRows: checkRows,
    markExisting: markExisting, caseIdOf: caseIdOf, jobRecord: jobRecord, ownerRecord: ownerRecord,
    templateCSV: templateCSV
  };
});
