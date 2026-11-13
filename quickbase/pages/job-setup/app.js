/*
 * Job Setup page logic: a spreadsheet-style grid people type into (or paste
 * into), checked as they go, then created in Quickbase.
 *
 * Quickbase calls use the REST shape; the QB-SESSION-SHIM above turns them
 * into same-origin XML API calls made as the signed-in user.
 */
(function () {
  "use strict";

  // ── settings ────────────────────────────────────────────────────────────
  // false = test mode: everything is checked and the page shows what it WOULD
  // create, but writes nothing. Flip to true only after the Mularz test run.
  var WRITE_ENABLED = false;

  var T = { jobs: "buskqh27b", owners: "buskqh27m", programs: "bwebf4xer" };
  var API = "https://api.quickbase.com/v1";
  var R = window.JobRules;
  var KEYS = R.COLUMNS.map(function (c) { return c.key; });

  // Filled in on every new row. Program only if it exists in Quickbase.
  var DEFAULTS = { program: "Pinellas Recovers Program", state: "Florida", status: "OPEN" };
  // A row is "blank" when none of these are filled (defaults don't count).
  var CONTENT_KEYS = ["jobName", "jobType", "street", "city", "zip", "price", "ownerName", "ownerPhone", "ownerEmail"];
  var WIDTH = { jobName: 270, jobType: 150, program: 220, street: 190, city: 130, zip: 80, state: 130,
    status: 120, price: 115, ownerName: 170, ownerPhone: 135, ownerEmail: 200 };

  // ── state ───────────────────────────────────────────────────────────────
  var programs = null;           // [{rid, name}] once loaded from Quickbase
  var connected = false;         // Quickbase reachable (page opened inside Quickbase)
  var rows = [];                 // {tr, errTr, st, cells:{key: input|select}, touched}
  var lastChecked = [];          // checkRows output for the filled rows
  var existingJobs = [];         // [{rid, name}] found in Quickbase
  var lookedJobs = {};           // case id / job name -> true once searched
  var ownersByEmail = {};        // email -> {rid, name} | null once searched
  var locked = false, busy = false;
  var validateTimer = null;

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function norm(s) { return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " "); }
  function recUrl(table, rid) {
    var host = /quickbase\.com$/.test(location.hostname) ? location.host : "byrdsonservices.quickbase.com";
    return "https://" + host + "/db/" + table + "?a=dr&rid=" + rid;
  }
  function qstr(s) { return String(s).replace(/'/g, ""); }  // QB query values can't hold a quote
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  function toast(title, detail, bad) {
    var el = document.createElement("div");
    el.className = "toast" + (bad ? " bad" : "");
    el.innerHTML = '<div class="t">' + esc(title) + "</div>" + (detail ? '<div class="d">' + esc(detail) + "</div>" : "");
    $("toasts").appendChild(el);
    setTimeout(function () { el.remove(); }, 6000);
  }
  function banner(msg, kind) {
    var b = $("banner");
    if (!msg) { b.className = "banner hide"; return; }
    b.className = "banner " + kind; b.innerHTML = msg;
  }

  // ── Quickbase calls ─────────────────────────────────────────────────────
  function qbQuery(from, select, where) {
    return fetch(API + "/records/query", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: from, select: select, where: where, options: { top: 5000 } })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.data) throw new Error((j && j.message) || "Query failed");
      return j.data;
    });
  }
  function qbCreate(to, record) {
    return fetch(API + "/records", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: to, data: [record] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var id = j && j.metadata && j.metadata.createdRecordIds && j.metadata.createdRecordIds[0];
      if (!id) throw new Error((j && j.message) || "Quickbase did not return a record id");
      return id;
    });
  }
  function queryAnyOf(from, select, conds) {
    var chunks = [], out = [];
    for (var i = 0; i < conds.length; i += 40) chunks.push(conds.slice(i, i + 40));
    return chunks.reduce(function (p, c) {
      return p.then(function () { return qbQuery(from, select, c.join("OR")); })
        .then(function (rs) { out = out.concat(rs); });
    }, Promise.resolve()).then(function () { return out; });
  }
  function v(rec, fid) { return rec[fid] ? rec[fid].value : null; }

  function loadPrograms() {
    return qbQuery(T.programs, [3, 6], "{3.GT.0}").then(function (rs) {
      programs = rs.map(function (r) { return { rid: v(r, 3), name: v(r, 6) }; })
        .filter(function (p) { return p.name; });
      connected = true;
    });
  }

  // ── grid cells ──────────────────────────────────────────────────────────
  function stateNames() {
    var seen = {};
    return Object.keys(R.STATES).map(function (k) { return R.STATES[k]; })
      .filter(function (n) { return seen[n] ? false : (seen[n] = true); }).sort();
  }
  function optionsFor(key) {
    if (key === "jobType") return R.JOB_TYPES;
    if (key === "status") return R.STATUSES;
    if (key === "state") return stateNames();
    if (key === "program") return programs ? programs.map(function (p) { return p.name; }).sort() : null;
    return null;
  }
  // Map what someone typed or pasted onto a dropdown option ("FL" -> Florida, "Rehab" -> Rehabilitation).
  function matchOption(key, value, opts) {
    var n = norm(value);
    var hit = opts.find(function (o) { return norm(o) === n; });
    if (hit) return hit;
    if (key === "jobType" && R.JOB_TYPE_ALIASES[n]) return R.JOB_TYPE_ALIASES[n];
    if (key === "state" && R.STATES[String(value).trim().toUpperCase()]) return R.STATES[String(value).trim().toUpperCase()];
    return null;
  }
  function makeCell(key) {
    var opts = optionsFor(key), el;
    if (opts) {
      el = document.createElement("select");
      el.innerHTML = '<option value=""></option>' + opts.map(function (o) { return "<option>" + esc(o) + "</option>"; }).join("");
    } else {
      el = document.createElement("input");
      el.type = "text"; el.autocomplete = "off"; el.spellcheck = false;
      if (key === "price") { el.inputMode = "decimal"; el.placeholder = "$"; }
    }
    el.dataset.key = key;
    return el;
  }
  function setValue(el, key, value) {
    value = value == null ? "" : String(value).trim();
    if (el.tagName !== "SELECT") { el.value = value; return; }
    if (value === "") { el.value = ""; return; }
    var opts = Array.prototype.map.call(el.options, function (o) { return o.value; }).filter(Boolean);
    var hit = matchOption(key, value, opts);
    if (!hit) {  // keep what they typed visible so the check can name it
      var o = document.createElement("option"); o.textContent = value; o.className = "unknown";
      el.appendChild(o); hit = value;
    }
    el.value = hit;
  }
  function fill(row, values, useDefaults) {
    KEYS.forEach(function (k) {
      var val = values && values[k] != null ? values[k] : "";
      if (val === "" && useDefaults && DEFAULTS[k]) val = DEFAULTS[k];
      if (k === "program" && val === DEFAULTS.program && programs &&
        !programs.some(function (p) { return p.name === val; })) val = "";
      setValue(row.cells[k], k, val);
    });
  }

  // ── rows ────────────────────────────────────────────────────────────────
  function addRow(values) {
    var tr = document.createElement("tr"), errTr = document.createElement("tr");
    var row = { tr: tr, errTr: errTr, cells: {}, touched: !!values };
    var rn = document.createElement("td"); rn.className = "rn"; tr.appendChild(rn);
    row.st = document.createElement("td"); row.st.className = "st"; tr.appendChild(row.st);
    R.COLUMNS.forEach(function (c) {
      var td = document.createElement("td");
      var el = makeCell(c.key);
      td.appendChild(el); tr.appendChild(td); row.cells[c.key] = el;
    });
    var dt = document.createElement("td");
    dt.innerHTML = '<button class="del" type="button" title="Remove this row">✕</button>';
    dt.firstChild.onclick = function () { removeRow(row); };
    tr.appendChild(dt);
    errTr.className = "errs hide";
    errTr.innerHTML = '<td></td><td colspan="' + (KEYS.length + 2) + '"></td>';
    $("gridBody").appendChild(tr); $("gridBody").appendChild(errTr);
    rows.push(row);
    fill(row, values, true);
    renumber();
    return row;
  }
  function removeRow(row) {
    if (locked) return;
    row.tr.remove(); row.errTr.remove();
    rows.splice(rows.indexOf(row), 1);
    if (!rows.length) addRow();
    renumber(); validate();
  }
  function renumber() { rows.forEach(function (r, i) { r.tr.firstChild.textContent = i + 1; }); }
  function rowOf(el) { return rows.find(function (r) { return r.tr.contains(el); }); }
  function readRaw(row) {
    var raw = {};
    KEYS.forEach(function (k) { raw[k] = String(row.cells[k].value || "").trim(); });
    return raw;
  }
  function isBlank(row) {
    var raw = readRaw(row);
    return CONTENT_KEYS.every(function (k) { return raw[k] === ""; });
  }
  function ensureTrailingBlank() {
    if (!rows.length || !isBlank(rows[rows.length - 1])) addRow();
  }

  // ── checking ────────────────────────────────────────────────────────────
  // Which column an error message is about, so that cell can be outlined.
  var ERR_FIELDS = [
    ["Already in Quickbase", "jobName"], ["Same Job Name", "jobName"], ["Same case", "jobName"],
    ["Address - Street 1", "street"], ["Address - City", "city"], ["Address - Zip", "zip"], ["Zip", "zip"],
    ["Address - State", "state"], ["State", "state"], ["Original Contract Price", "price"],
    ["Homeowner Name", "ownerName"], ["Phone Number", "ownerPhone"], ["Email", "ownerEmail"],
    ["Job Name", "jobName"], ["Job Type", "jobType"], ["Program", "program"], ["Status", "status"]
  ];
  function fieldOf(msg) {
    var hit = ERR_FIELDS.find(function (p) { return msg.indexOf(p[0]) === 0; });
    return hit ? hit[1] : null;
  }
  function jobKey(c) { return c.data.caseId || norm(c.data.jobName); }

  function scheduleValidate() {
    clearTimeout(validateTimer);
    validateTimer = setTimeout(validate, 200);
  }

  function validate() {
    var filled = rows.filter(function (r) { return !isBlank(r); });
    var input = filled.map(function (r) { return { rowNumber: rows.indexOf(r) + 1, raw: readRaw(r) }; });
    var checked = R.checkRows(input, { programs: programs ? programs.map(function (p) { return p.name; }) : null });
    if (connected) R.markExisting(checked, existingJobs);
    checked.forEach(function (c, i) {
      c.ref = filled[i];
      c.owner = connected && c.data.ownerEmail ? ownersByEmail[c.data.ownerEmail] || null : null;
      c.pending = connected && !c.errors.length &&
        (!lookedJobs[jobKey(c)] || (c.data.ownerEmail && !(c.data.ownerEmail in ownersByEmail)));
    });
    lastChecked = checked;

    rows.forEach(function (r) {
      var c = checked.find(function (x) { return x.ref === r; });
      paintRow(r, c);
    });
    updateBar();
  }

  function paintRow(r, c) {
    KEYS.forEach(function (k) { r.cells[k].parentNode.classList.remove("bad"); });
    var errCell = r.errTr.lastChild;
    if (!c) { r.st.innerHTML = ""; r.errTr.classList.add("hide"); return; }
    var show = r.touched;
    if (c.errors.length && show) {
      c.errors.forEach(function (e) { var k = fieldOf(e); if (k) r.cells[k].parentNode.classList.add("bad"); });
      r.st.innerHTML = '<span class="st-bad">✕ ' + plural(c.errors.length, "problem") + "</span>";
    } else if (c.errors.length) {
      r.st.innerHTML = '<span class="st-wait">Incomplete</span>';
    } else if (c.pending) {
      r.st.innerHTML = '<span class="st-wait">Checking Quickbase…</span>';
    } else {
      r.st.innerHTML = '<span class="st-ok">✓ Ready</span>' + (c.owner
        ? ' <span class="st-own">· homeowner <a target="_blank" href="' + recUrl(T.owners, c.owner.rid) + '">#' + c.owner.rid + "</a></span>"
        : (connected ? ' <span class="st-own">· new homeowner</span>' : ""));
    }
    var lines = (show ? c.errors.map(function (e) { return '<span class="bu-err">✕ ' + esc(e) + "</span>"; }) : [])
      .concat(!c.errors.length ? c.warnings.map(function (w) { return '<span class="bu-wn">• ' + esc(w) + "</span>"; }) : []);
    errCell.innerHTML = lines.join("");
    r.errTr.classList.toggle("hide", !lines.length);
  }

  function counts() {
    var ready = lastChecked.filter(function (c) { return !c.errors.length && !c.pending; }).length;
    var bad = lastChecked.filter(function (c) { return c.errors.length; }).length;
    var pending = lastChecked.filter(function (c) { return c.pending; }).length;
    return { ready: ready, bad: bad, pending: pending, filled: lastChecked.length };
  }

  function updateBar() {
    if (locked) return;
    var n = counts(), btn = $("createBtn");
    btn.disabled = busy || !connected || !n.ready || n.pending > 0;
    btn.textContent = (WRITE_ENABLED ? "Create " : "Test run: ") + plural(n.ready, "job");
    var parts = [];
    if (!n.filled) parts.push("Start typing in the first row.");
    else {
      parts.push(n.ready + " ready");
      if (n.bad) parts.push(plural(n.bad, "row") + " to fix");
      if (n.pending) parts.push("checking Quickbase…");
    }
    if (!connected) parts.push("Open this page inside Quickbase to create jobs.");
    $("actNote").textContent = parts.join(" · ");
  }

  // Look up new job names / case numbers and homeowner emails in Quickbase.
  function lookup() {
    if (!connected) return;
    var jobs = [], emails = [];
    lastChecked.forEach(function (c) {
      var k = jobKey(c);
      if (k && !lookedJobs[k] && jobs.indexOf(c) < 0) jobs.push(c);
      var e = c.data.ownerEmail;
      if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !(e in ownersByEmail) && emails.indexOf(e) < 0) emails.push(e);
    });
    if (!jobs.length && !emails.length) return;
    var jobConds = jobs.map(function (c) {
      return c.data.caseId ? "{6.CT.'" + qstr(c.data.caseId) + "'}" : "{6.EX.'" + qstr(c.data.jobName) + "'}";
    });
    var emailConds = emails.map(function (e) { return "{8.EX.'" + qstr(e) + "'}"; });
    Promise.all([
      jobConds.length ? queryAnyOf(T.jobs, [3, 6], jobConds) : [],
      emailConds.length ? queryAnyOf(T.owners, [3, 6, 8], emailConds) : []
    ]).then(function (res) {
      res[0].forEach(function (rec) {
        var hit = { rid: v(rec, 3), name: v(rec, 6) || "" };
        if (!existingJobs.some(function (e) { return e.rid === hit.rid; })) existingJobs.push(hit);
      });
      jobs.forEach(function (c) { lookedJobs[jobKey(c)] = true; });
      emails.forEach(function (e) { ownersByEmail[e] = null; });
      res[1].forEach(function (rec) {
        var e = String(v(rec, 8) || "").toLowerCase();
        if (e && !ownersByEmail[e]) ownersByEmail[e] = { rid: v(rec, 3), name: v(rec, 6) };
      });
      validate();
    }).catch(function (e) {
      banner("Couldn't check Quickbase for duplicates (" + esc(e.message) + "). Try again in a moment.", "bad");
    });
  }

  function afterBulkChange() {
    ensureTrailingBlank();
    validate();
    lookup();
  }

  // ── paste from a spreadsheet ────────────────────────────────────────────
  function isHeaderLine(cells) {
    if (/^field id:/i.test(cells[0] || "")) return true;
    return cells.filter(function (x) { return R.COLUMNS.some(function (c) { return norm(c.label) === norm(x); }); }).length >= 3;
  }
  function onPaste(e) {
    var el = e.target;
    if (locked || !el.dataset || !el.dataset.key) return;
    var text = (e.clipboardData || window.clipboardData).getData("text") || "";
    var body = text.replace(/\r/g, "").replace(/\n+$/, "");
    if (body.indexOf("\t") < 0 && body.indexOf("\n") < 0) return;  // one value: normal paste
    e.preventDefault();
    var lines = body.split("\n").map(function (l) { return l.split("\t"); })
      .filter(function (cells) { return !isHeaderLine(cells); });
    var r0 = rows.indexOf(rowOf(el)), c0 = KEYS.indexOf(el.dataset.key);
    lines.forEach(function (cells, i) {
      var row = rows[r0 + i] || addRow();
      cells.forEach(function (val, j) {
        var k = KEYS[c0 + j];
        if (!k) return;
        val = val.trim();
        if (val === "" && DEFAULTS[k]) return;  // keep the default
        setValue(row.cells[k], k, val);
      });
      row.touched = true;
    });
    afterBulkChange();
    toast(plural(lines.length, "row") + " pasted");
  }

  // ── load a CSV into the grid ────────────────────────────────────────────
  function loadCSV(file) {
    if (!file || locked) return;
    if (/\.xlsx?$/i.test(file.name)) {
      banner("That's an Excel file. Save it as CSV first, or copy the rows in Excel and paste them into the table.", "bad");
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var t = R.readTemplate(R.parseCSV(String(reader.result || "")));
      if (!t.ok) { banner(esc(t.error), "bad"); return; }
      if (!t.rows.length) { banner("That file has the headers but no jobs in it.", "warn"); return; }
      banner(connected ? null : banner.offline, "warn");
      rows.filter(isBlank).forEach(function (r) { r.tr.remove(); r.errTr.remove(); rows.splice(rows.indexOf(r), 1); });
      t.rows.forEach(function (d) { addRow(d.raw); });
      afterBulkChange();
      toast(plural(t.rows.length, "row") + " loaded from " + file.name);
    };
    reader.readAsText(file);
    $("file").value = "";
  }

  // ── keyboard ────────────────────────────────────────────────────────────
  function onKey(e) {
    if (e.key !== "Enter" || locked) return;
    var el = e.target, row = rowOf(el);
    if (!row || !el.dataset.key) return;
    e.preventDefault();
    var i = rows.indexOf(row);
    var next = rows[i + 1] || addRow();
    next.cells[el.dataset.key].focus();
  }

  // ── reference panel ─────────────────────────────────────────────────────
  function chips(list) {
    return '<div class="bu-chips">' + list.map(function (x) { return '<span class="bu-chip">' + esc(x) + "</span>"; }).join("") + "</div>";
  }
  function renderRef() {
    $("ref").innerHTML =
      "<h4>Job Type</h4>" + chips(R.JOB_TYPES) +
      '<div class="bu-note">Pasted "Rehab" and "Recon" become Rehabilitation and Reconstruction.</div>' +
      "<h4>Status</h4>" + chips(R.STATUSES) +
      "<h4>Phone and email</h4><div class=\"bu-note\">Phone needs 10 digits. If the email matches a homeowner already in Quickbase, " +
      "that homeowner is reused instead of creating a new one.</div>" +
      "<h4>Duplicates</h4><div class=\"bu-note\">A job is blocked if its Job Name, or its case number (for example PC-HRRP-176424), " +
      "is already in Quickbase or appears twice in the table.</div>";
  }

  // ── create ──────────────────────────────────────────────────────────────
  function create() {
    var ready = lastChecked.filter(function (c) { return !c.errors.length && !c.pending; });
    if (busy || locked || !ready.length || !connected) return;
    var bad = counts().bad;
    var msg = (WRITE_ENABLED ? "Create " : "Test run for ") + plural(ready.length, "job") + "?" +
      (bad ? "\n\n" + plural(bad, "row") + " with problems will be skipped." : "") +
      (WRITE_ENABLED ? "" : "\n\nTest mode: nothing will be saved.");
    if (!window.confirm(msg)) return;

    busy = true; lock(true);
    var progLink = {};
    programs.forEach(function (p) { progLink[p.name] = p.rid; });
    var results = [];
    ready.reduce(function (p, c, i) {
      return p.then(function () {
        $("actNote").textContent = (WRITE_ENABLED ? "Creating " : "Test run ") + (i + 1) + " of " + ready.length + "…";
        var res = { row: c, ownerRid: c.owner ? c.owner.rid : null, ownerNew: !c.owner, jobRid: null, error: null };
        results.push(res);
        if (!WRITE_ENABLED) return;
        var ownerStep = c.owner ? Promise.resolve(c.owner.rid) : qbCreate(T.owners, R.ownerRecord(c.data));
        return ownerStep.then(function (ownerRid) {
          res.ownerRid = ownerRid;
          if (c.data.ownerEmail) ownersByEmail[c.data.ownerEmail] = { rid: ownerRid, name: c.data.ownerName };
          return qbCreate(T.jobs, R.jobRecord(c.data, { ownerRid: ownerRid, programRid: progLink[c.data.program] }));
        }).then(function (jobRid) {
          res.jobRid = jobRid;
          existingJobs.push({ rid: jobRid, name: c.data.jobName });
        }).catch(function (e) { res.error = e.message || String(e); });
      });
    }, Promise.resolve()).then(function () { busy = false; renderResults(results); });
  }

  function lock(on) {
    locked = on;
    rows.forEach(function (r) {
      KEYS.forEach(function (k) { r.cells[k].disabled = on; });
      r.tr.lastChild.firstChild.disabled = on;
    });
    $("gridTools").classList.toggle("hide", on);
    $("createBtn").disabled = on;
    $("againBtn").disabled = on && busy;
  }

  function renderResults(results) {
    var ok = results.filter(function (x) { return !x.error; }).length, failed = results.length - ok;
    var html = '<div class="bu-sum">' +
      (WRITE_ENABLED ? '<span class="bu-tag bu-ok">' + ok + " created</span>"
        : '<span class="bu-tag bu-info">Test run · nothing was saved</span><span class="bu-tag bu-ok">' + ok + " would be created</span>") +
      (failed ? '<span class="bu-tag bu-bad">' + failed + " failed</span>" : "") + "</div>";
    html += '<div class="bu-scroll"><table class="bu-tbl"><thead><tr><th>Row</th><th>Job Name</th><th>Job</th><th>Homeowner</th><th>Result</th></tr></thead><tbody>';
    results.forEach(function (x) {
      var d = x.row.data;
      var job = x.jobRid ? '<a target="_blank" href="' + recUrl(T.jobs, x.jobRid) + '">#' + x.jobRid + "</a>" : (WRITE_ENABLED ? "" : "New");
      var owner = x.ownerRid ? '<a target="_blank" href="' + recUrl(T.owners, x.ownerRid) + '">#' + x.ownerRid + "</a>" +
        (x.ownerNew ? " (new)" : " (existing)") : (WRITE_ENABLED ? "" : "New");
      var resTxt = x.error ? '<div class="bu-err">✕ ' + esc(x.error) + "</div>"
        : '<div class="bu-okt">✓ ' + (WRITE_ENABLED ? "Created" : "Would be created") + "</div>";
      html += '<tr class="' + (x.error ? "bad" : "") + '"><td class="rn">' + x.row.rowNumber + "</td><td>" + esc(d.jobName) +
        "</td><td>" + job + "</td><td>" + esc(d.ownerName) + " · " + owner + "</td><td>" + resTxt + "</td></tr>";
    });
    html += "</tbody></table></div>";
    if (failed && WRITE_ENABLED) {
      html += '<div class="bu-note">Rows that failed were not created. Start a new batch to try them again; ' +
        "a homeowner created for a failed row is reused when the email matches.</div>";
    }
    $("result").innerHTML = html;
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
    $("againBtn").disabled = false;
    $("againBtn").textContent = "Start a new batch";
    $("createBtn").classList.add("hide");
    $("actNote").textContent = WRITE_ENABLED ? plural(ok, "job") + " created." : "Test run finished. Nothing was saved.";
    toast(WRITE_ENABLED ? plural(ok, "job") + " created" : "Test run finished",
      failed ? failed + " row(s) failed. See the table." : (WRITE_ENABLED ? "" : "Nothing was saved."), !!failed);
  }

  function clearAll() {
    if (busy) return;
    var hasData = rows.some(function (r) { return !isBlank(r); });
    if (!locked && hasData && !window.confirm("Clear every row in the table?")) return;
    lock(false);
    rows.forEach(function (r) { r.tr.remove(); r.errTr.remove(); });
    rows = []; lastChecked = [];
    for (var i = 0; i < 3; i++) addRow();
    $("result").innerHTML = "";
    $("createBtn").classList.remove("hide");
    $("againBtn").textContent = "Clear all";
    validate();
    rows[0].cells.jobName.focus();
  }

  // Swap the Program text boxes for dropdowns once the program list arrives.
  function upgradeProgramCells() {
    rows.forEach(function (r) {
      var old = r.cells.program, val = old.value;
      var el = makeCell("program");
      old.parentNode.replaceChild(el, old);
      r.cells.program = el;
      setValue(el, "program", val || (programs.some(function (p) { return p.name === DEFAULTS.program; }) ? DEFAULTS.program : ""));
    });
  }

  // ── wiring ──────────────────────────────────────────────────────────────
  function init() {
    var tag = $("modeTag");
    tag.textContent = WRITE_ENABLED ? "Live" : "Test mode · nothing is saved";
    tag.className = "mode" + (WRITE_ENABLED ? "" : " test");

    $("gridHead").innerHTML = "<tr><th>#</th><th>Check</th>" + R.COLUMNS.map(function (c) {
      return '<th style="min-width:' + WIDTH[c.key] + 'px">' + esc(c.label) + (c.required ? ' <span class="bu-req">*</span>' : "") + "</th>";
    }).join("") + "<th></th></tr>";

    var body = $("gridBody");
    body.addEventListener("input", scheduleValidate);
    body.addEventListener("change", function (e) {
      var r = rowOf(e.target);
      validate(); lookup();
      if (r === rows[rows.length - 1] && !isBlank(r)) ensureTrailingBlank();
    });
    // A row's problems show in red only once the person leaves that row, so
    // nothing turns red while they are still typing across it.
    body.addEventListener("focusout", function (e) {
      var r = rowOf(e.target);
      if (!r || (e.relatedTarget && r.tr.contains(e.relatedTarget))) return;
      if (!isBlank(r) && !r.touched) { r.touched = true; validate(); }
    });
    body.addEventListener("paste", onPaste);
    body.addEventListener("keydown", onKey);

    $("addRow").onclick = function () { addRow().cells.jobName.focus(); };
    $("add5").onclick = function () { for (var i = 0; i < 5; i++) addRow(); };
    $("file").onchange = function () { loadCSV(this.files[0]); };
    $("createBtn").onclick = create;
    $("againBtn").onclick = clearAll;

    for (var i = 0; i < 3; i++) addRow();
    renderRef();
    validate();

    loadPrograms().then(function () {
      upgradeProgramCells();
      validate(); lookup();
    }).catch(function () {
      connected = false;
      banner.offline = "Can't reach Quickbase from here. You can type and check rows, but Programs and duplicates " +
        "aren't checked and nothing can be saved. Open this page inside Quickbase to create jobs.";
      banner(banner.offline, "warn");
      updateBar();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
