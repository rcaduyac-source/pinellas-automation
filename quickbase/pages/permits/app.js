/*
 * Permits page logic: pick a Pinellas job, then
 *   1. the permit requirements checklist (Needed / Received / Not needed + a file per item)
 *   2. the job's permit documents (Attachments, category "Permits") + upload
 *   3. the job's US Permits rows: edit, add, mark Voided (does not apply), restore
 *
 * Quickbase calls use the REST shape; the QB-SESSION-SHIM above turns them
 * into same-origin XML API calls made as the signed-in user.
 */
(function () {
  "use strict";

  // ── settings ────────────────────────────────────────────────────────────
  // false = test mode: the page reads everything and shows what each button
  // WOULD save, but writes nothing. Flip to true after the Mularz test run.
  var WRITE_ENABLED = false;

  var R = window.PermitRules;
  var T = R.T, F = R.F;
  var API = "https://api.quickbase.com/v1";
  var MAX_FILE = 15 * 1024 * 1024;
  var CLOSED = /^(COMPLETED|CANCELLED|WITHDRAWN|INACTIVE)$/i;

  // ── state ───────────────────────────────────────────────────────────────
  var jobs = [];                 // [{rid, name, street, city, zip, type, status}]
  var job = null;                // the picked job
  var reqRows = {};              // requirement id -> {rid, status, notes}
  var docs = [];                 // [{rid, name, url, description, drive, created}]
  var permits = [];              // [{rid, type, title, status, ...}]
  var choices = { types: [], statuses: [] };
  var me = "";                   // signed-in user's name, for notes
  var editing = null;            // permit rid | "new" | null
  var voiding = null;            // permit rid | null
  var showVoided = false;
  var busy = false;

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function qstr(s) { return String(s).replace(/'/g, ""); }
  function host() { return /quickbase\.com$/.test(location.hostname) ? location.host : "byrdsonservices.quickbase.com"; }
  function recUrl(table, rid) { return "https://" + host() + "/db/" + table + "?a=dr&rid=" + rid; }
  function fmtDate(v) {
    if (!v) return "—";
    var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Number(m[2]) + "/" + Number(m[3]) + "/" + m[1] : String(v);
  }
  function money(n) { return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  function pill(text, tone) { return '<span class="pill p-' + tone + '">' + esc(text) + "</span>"; }

  function toast(title, detail, bad) {
    var el = document.createElement("div");
    el.className = "toast" + (bad ? " bad" : "");
    el.innerHTML = '<div class="t1">' + esc(title) + "</div>" + (detail ? '<div class="d">' + esc(detail) + "</div>" : "");
    $("toasts").appendChild(el);
    setTimeout(function () { el.remove(); }, 7000);
  }
  function defaultBanner() {
    if (WRITE_ENABLED) banner("");
    else banner("<b>Test mode.</b> Everything is read from Quickbase, but nothing is saved: each button shows what it would save.", "warn");
  }
  function banner(msg, kind) {
    var b = $("banner");
    if (!msg) { b.className = "banner hide"; return; }
    b.className = "banner " + kind; b.innerHTML = msg;
  }

  // ── Quickbase calls ─────────────────────────────────────────────────────
  function qbQuery(from, select, where, sortBy) {
    return fetch(API + "/records/query", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: from, select: select, where: where, sortBy: sortBy, options: { top: 5000 } })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.data) throw new Error((j && (j.description || j.message)) || "Query failed");
      return j.data;
    });
  }
  function v(rec, fid) { return rec[fid] ? rec[fid].value : null; }
  function s(rec, fid) { var x = v(rec, fid); return x == null ? "" : String(x); }

  /** Saves one record (edits it when it carries field 3). Test mode only reports what it would save. */
  function qbSave(to, record, what) {
    if (!WRITE_ENABLED) {
      var shown = {};
      Object.keys(record).forEach(function (k) {
        var x = record[k];
        shown[k] = x && typeof x === "object" && x.fileName ? "[file " + x.fileName + "]" : x;
      });
      console.info("[Permits test mode] would save to " + to, shown);
      toast("Test mode: not saved", what + "\nNothing was written. The record is in the browser console.");
      return Promise.resolve(null);
    }
    var data = {};
    Object.keys(record).forEach(function (k) { data[k] = { value: record[k] }; });
    return fetch(API + "/records", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: to, data: [data] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.metadata) throw new Error((j && (j.description || j.message)) || "Quickbase did not save it");
      var errs = j.metadata.lineErrors && Object.keys(j.metadata.lineErrors).length ? JSON.stringify(j.metadata.lineErrors) : "";
      if (errs) throw new Error(errs);
      return record[3] || (j.metadata.createdRecordIds && j.metadata.createdRecordIds[0]) || null;
    });
  }
  function fieldChoices(table) {
    return fetch(API + "/fields?tableId=" + table).then(function (r) { return r.json(); }).then(function (list) {
      var out = {};
      (Array.isArray(list) ? list : []).forEach(function (f) { out[f.id] = (f.properties && f.properties.choices) || []; });
      return out;
    });
  }
  /** The signed-in user's name (best effort; notes still save without it). */
  function whoAmI() {
    if (!/quickbase\.com$/.test(location.hostname)) return Promise.resolve("");
    return fetch("/db/main", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/xml", "QUICKBASE-ACTION": "API_GetUserInfo" }, body: "<qdbapi></qdbapi>" })
      .then(function (r) { return r.text(); }).then(function (t) {
        var d = new DOMParser().parseFromString(t, "text/xml");
        var first = (d.querySelector("firstName") || {}).textContent || "", last = (d.querySelector("lastName") || {}).textContent || "";
        return (first + " " + last).trim();
      }).catch(function () { return ""; });
  }

  /** File attachment values arrive as "<download url><file name>". */
  function fileOf(raw) {
    var m = String(raw || "").match(/^(https?:\/\/\S*?\/v\d+)(.*)$/);
    return m ? { url: m[1], name: m[2] } : { url: "", name: String(raw || "") };
  }

  // ── jobs ────────────────────────────────────────────────────────────────
  function loadJobs() {
    var J = F.job;
    return qbQuery(T.jobs, [3, J.name, J.street, J.city, J.zip, J.type, J.status, J.program],
      "{" + J.program + ".CT.'Pinellas'}", [{ fieldId: J.name, order: "ASC" }]).then(function (rs) {
      jobs = rs.map(function (r) {
        return { rid: v(r, 3), name: s(r, J.name), street: s(r, J.street), city: s(r, J.city), zip: s(r, J.zip),
          type: s(r, J.type), status: s(r, J.status), program: s(r, J.program) };
      });
    });
  }
  function renderJobList() {
    var q = $("jobSearch").value.trim().toLowerCase();
    var closed = $("showClosed").checked;
    var list = jobs.filter(function (j) {
      if (!closed && CLOSED.test(j.status) && !(job && job.rid === j.rid)) return false;
      return !q || (j.name + " " + j.street + " " + j.city).toLowerCase().indexOf(q) > -1;
    });
    $("jobSelect").innerHTML = '<option value="">' + (list.length ? "Choose a job (" + list.length + ")…" : "No job matches") + "</option>" +
      list.map(function (j) {
        return '<option value="' + j.rid + '"' + (job && job.rid === j.rid ? " selected" : "") + ">" +
          esc(j.name) + (CLOSED.test(j.status) ? " (" + esc(j.status) + ")" : "") + "</option>";
      }).join("");
  }
  function pickJob(rid) {
    job = jobs.find(function (j) { return String(j.rid) === String(rid); }) || null;
    editing = null; voiding = null;
    try {
      var u = new URL(location.href);
      if (job) u.searchParams.set("job", job.rid); else u.searchParams.delete("job");
      history.replaceState(null, "", u.toString());
    } catch (e) { /* the address bar just won't remember the job */ }
    if (!job) { $("jobArea").classList.add("hide"); $("jobMeta").classList.add("hide"); return Promise.resolve(); }
    var t = R.awardType(job.type);
    $("jobMeta").innerHTML =
      "<span><b>" + esc(job.name) + '</b> · <a target="_blank" href="' + recUrl(T.jobs, job.rid) + '">open job #' + job.rid + "</a></span>" +
      "<span>Type: <b>" + esc(job.type || "—") + "</b>" + (t && t !== job.type ? " (checklist: " + esc(t) + ")" : "") + "</span>" +
      "<span>" + esc([job.street, job.city, job.zip].filter(Boolean).join(", ") || "No address") + "</span>" +
      "<span>Status: <b>" + esc(job.status || "—") + "</b></span>";
    $("jobMeta").classList.remove("hide");
    $("jobArea").classList.remove("hide");
    return loadJob();
  }

  // ── one job ─────────────────────────────────────────────────────────────
  function loadJob() {
    if (!job) return Promise.resolve();
    var rid = job.rid, K = F.task, A = F.att, P = F.permit;
    defaultBanner();
    return Promise.all([
      qbQuery(T.tasks, [3, K.templateId, K.status, K.notes],
        "{" + K.job + ".EX." + rid + "}AND{" + K.templateId + ".SW.'PR-'}AND{" + K.workflow + ".EX.'" + R.WORKFLOW + "'}"),
      qbQuery(T.attachments, [3, A.file, A.name, A.description, A.drive, A.created],
        "{" + A.job + ".EX." + rid + "}AND{" + A.category + ".EX.'" + R.DOC_CATEGORY + "'}", [{ fieldId: A.created, order: "DESC" }]),
      qbQuery(T.permits, [3, P.type, P.title, P.status, P.number, P.submitted, P.approved, P.expires, P.fee, P.paid, P.paidDate, P.notes, P.job],
        "{" + P.job + ".EX." + rid + "}", [{ fieldId: 3, order: "ASC" }])
    ]).then(function (res) {
      if (!job || job.rid !== rid) return;  // another job was picked meanwhile
      reqRows = {};
      res[0].forEach(function (r) { reqRows[s(r, K.templateId)] = { rid: v(r, 3), status: s(r, K.status), notes: s(r, K.notes) }; });
      docs = res[1].map(function (r) {
        var f = fileOf(s(r, A.file));
        return { rid: v(r, 3), name: s(r, A.name) || f.name || "File", url: f.url, description: s(r, A.description), drive: s(r, A.drive), created: s(r, A.created) };
      });
      permits = res[2].map(function (r) {
        return { rid: v(r, 3), type: s(r, P.type), title: s(r, P.title), status: s(r, P.status) || "Not Started", number: s(r, P.number),
          submitted: s(r, P.submitted), approved: s(r, P.approved), expires: s(r, P.expires), fee: Number(v(r, P.fee)) || 0,
          paid: !!v(r, P.paid), paidDate: s(r, P.paidDate), notes: s(r, P.notes) };
      });
      renderAll();
    }).catch(function (e) { banner("Could not load this job: " + esc(e.message), "bad"); });
  }
  function renderAll() { renderReqs(); renderDocs(); renderPermits(); }

  // ── 1. requirements ─────────────────────────────────────────────────────
  var CHECK_TONE = { "Confirmed": "ok", "Partly": "warn", "Not confirmed": "warn", "Missing": "bad" };
  var STATE_TONE = { "Needed": "warn", "Received": "ok", "Not needed": "grey" };

  function docLink(d) {
    var drive = d.drive ? ' · <a target="_blank" href="https://drive.google.com/file/d/' + esc(d.drive) + '/view">Drive</a>' : "";
    return (d.url ? '<a target="_blank" href="' + esc(d.url) + '">' + esc(d.name) + "</a>" : esc(d.name)) +
      ' · <a target="_blank" href="' + recUrl(T.attachments, d.rid) + '">record</a>' + drive;
  }

  function renderReqs() {
    var reqs = R.reqsFor(job.type);
    $("reqTitle").textContent = "Permit requirements" + (reqs.length ? " — " + reqs[0].type : "");
    if (!reqs.length) {
      $("reqBody").innerHTML = ""; $("reqCount").innerHTML = "";
      $("reqEmpty").textContent = "The checklist covers MHU, Rehabilitation and Reconstruction jobs. This job's type is \"" + (job.type || "blank") + "\".";
      $("reqEmpty").classList.remove("hide");
      return;
    }
    $("reqEmpty").classList.add("hide");
    var open = 0;
    $("reqBody").innerHTML = reqs.map(function (r) {
      var row = reqRows[r.id], state = row ? R.stateOf(row.status) : "Needed";
      if (state === "Needed") open++;
      var files = R.filedFor(docs, r.name);
      return '<tr data-req="' + r.id + '">' +
        '<td style="max-width:440px"><div class="nm">' + esc(r.name) + "</div>" +
          (r.when ? '<div class="when">Only when: ' + esc(r.when) + "</div>" : "") +
          "<details><summary>Action and sources</summary>" +
            "<div><b>Action needed:</b> " + esc(r.action) + "</div><div>" + esc(r.sources) + "</div><div><i>" + esc(r.source) + "</i></div></details>" +
          (row && row.notes ? '<div class="sub">' + esc(row.notes) + "</div>" : "") +
          (files.length ? '<div class="files">' + files.map(function (d) { return "<div>📎 " + docLink(d) + "</div>"; }).join("") + "</div>" : "") +
        "</td>" +
        '<td class="sm">' + esc(r.who) + "</td>" +
        "<td>" + pill(r.check, CHECK_TONE[r.check] || "grey") + (r.listed ? "" : '<div class="new-tag">new — was not on our list</div>') + "</td>" +
        '<td><select class="in req-state" style="min-width:120px">' +
          R.REQ_STATES.map(function (x) { return "<option" + (x === state ? " selected" : "") + ">" + x + "</option>"; }).join("") +
          '</select><div style="margin-top:5px">' + pill(state, STATE_TONE[state]) + "</div></td>" +
        '<td class="nw"><label class="btn b-out sm" style="display:inline-block">Upload<input type="file" class="req-file" hidden /></label></td>' +
        "</tr>";
    }).join("");
    $("reqCount").innerHTML = pill(open ? open + " of " + reqs.length + " still needed" : "all handled", open ? "warn" : "ok");
  }

  function setRequirement(reqId, state, selectEl) {
    var def = R.REQS.find(function (x) { return x.id === reqId; });
    var note = "";
    if (state === "Not needed") {
      note = window.prompt('Why is "' + def.name + '" not needed on this job?') || "";
      if (!note.trim()) { toast("Not saved", "Say why it is not needed.", true); renderReqs(); return; }
    }
    var out = R.requirementRecord({ req: def, state: state, note: note, jobRid: job.rid, existing: reqRows[reqId] || null, date: R.today(), who: me });
    if (out.error) { toast("Not saved", out.error, true); renderReqs(); return; }
    selectEl.disabled = true;
    qbSave(T.tasks, out.record, def.name + " → " + state).then(function (rid) {
      if (rid) { toast("Saved", def.name + ": " + state); return loadJob(); }
      renderReqs();
    }).catch(function (e) { toast("Could not save", e.message, true); renderReqs(); });
  }

  // ── 2. documents ────────────────────────────────────────────────────────
  function renderDocs() {
    $("docBody").innerHTML = docs.map(function (d) {
      return "<tr><td>" + docLink(d) + '</td><td class="sm">' + esc(d.description) + '</td><td class="sm num">' + fmtDate(d.created) + "</td></tr>";
    }).join("");
    $("docEmpty").classList.toggle("hide", docs.length > 0);
    var keep = $("upPermit").value;
    $("upPermit").innerHTML = '<option value="">—</option>' + permits.filter(function (p) { return p.status !== "Voided"; }).map(function (p) {
      return '<option value="' + p.rid + '">' + esc(p.type + (p.number ? " · " + p.number : "")) + "</option>";
    }).join("");
    $("upPermit").value = keep;
  }

  function readBase64(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(",")[1] || ""); };
      fr.onerror = function () { reject(new Error("Could not read the file.")); };
      fr.readAsDataURL(file);
    });
  }
  function uploadDoc(file, docType, permitRid, note) {
    if (!file) { toast("Pick a file first.", "", true); return Promise.resolve(false); }
    if (file.size > MAX_FILE) { toast("File too big", file.name + " is " + (file.size / 1048576).toFixed(1) + " MB. The limit here is 15 MB.", true); return Promise.resolve(false); }
    var permit = permitRid ? permits.find(function (p) { return String(p.rid) === String(permitRid); }) : null;
    var A = F.att;
    return readBase64(file).then(function (b64) {
      var rec = {};
      rec[A.job] = job.rid;
      rec[A.category] = R.DOC_CATEGORY;
      rec[A.name] = file.name;
      rec[A.description] = R.docDescription({ docType: docType, permit: permit, note: note, who: me, date: R.today() });
      rec[A.file] = { fileName: file.name, data: b64 };
      return qbSave(T.attachments, rec, "Upload " + file.name + " (" + docType + ")");
    }).then(function (rid) {
      if (rid) { toast("Uploaded", file.name); return loadJob().then(function () { return true; }); }
      return false;
    }).catch(function (e) { toast("Upload failed", e.message, true); return false; });
  }

  // ── 3. US Permits ───────────────────────────────────────────────────────
  function blankForm() { return { type: "", title: "", status: "Not Started", number: "", submitted: "", approved: "", expires: "", fee: "", paid: false, paidDate: "", notes: "" }; }
  function choiceInput(id, list, value, allowBlank) {
    if (!list.length) return '<input class="in" id="' + id + '" value="' + esc(value) + '" />';
    var opts = list.slice();
    if (value && opts.indexOf(value) < 0) opts.unshift(value);
    return '<select class="in" id="' + id + '">' + (allowBlank ? '<option value="">Choose…</option>' : "") +
      opts.map(function (o) { return "<option" + (o === value ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select>";
  }
  function editorHtml(key, f) {
    var id = function (k) { return "pf-" + key + "-" + k; };
    var date = function (k, label) { return '<label class="lb" for="' + id(k) + '">' + label + '<input class="in" type="date" id="' + id(k) + '" value="' + esc(f[k]) + '" /></label>'; };
    return '<div class="form" data-editor="' + key + '">' +
      '<label class="lb" for="' + id("type") + '">Permit type' + choiceInput(id("type"), choices.types, f.type, true) + "</label>" +
      '<label class="lb s2" for="' + id("title") + '">Description<input class="in" id="' + id("title") + '" value="' + esc(f.title) + '" placeholder="e.g. MHU setup, Lot 651" /></label>' +
      '<label class="lb" for="' + id("status") + '">Status' + choiceInput(id("status"), choices.statuses.filter(function (x) { return x !== "Voided"; }), f.status, false) + "</label>" +
      '<label class="lb" for="' + id("number") + '">Permit number<input class="in" id="' + id("number") + '" value="' + esc(f.number) + '" /></label>' +
      date("submitted", "Submitted") + date("approved", "Issued / approved") + date("expires", "Expires") +
      '<label class="lb" for="' + id("fee") + '">Fee ($)<input class="in" inputmode="decimal" id="' + id("fee") + '" value="' + esc(f.fee) + '" /></label>' +
      date("paidDate", "Fee paid on") +
      '<label class="ck" for="' + id("paid") + '" style="align-self:end;padding-bottom:9px"><input type="checkbox" id="' + id("paid") + '"' + (f.paid ? " checked" : "") + " />Fee paid</label>" +
      '<label class="lb s4" for="' + id("notes") + '">Notes<textarea class="in" id="' + id("notes") + '">' + esc(f.notes) + "</textarea></label>" +
      '<div class="errs" id="' + id("errs") + '"></div>' +
      '<div class="acts"><button class="btn b-navy" type="button" data-act="save">' + (key === "new" ? "Add permit" : "Save") + "</button>" +
      '<button class="btn b-out" type="button" data-act="cancel">Cancel</button></div></div>';
  }
  function readEditor(key) {
    var g = function (k) { var el = $("pf-" + key + "-" + k); return el ? el.value : ""; };
    return { type: g("type"), title: g("title"), status: g("status"), number: g("number"), submitted: g("submitted"), approved: g("approved"),
      expires: g("expires"), fee: g("fee"), paid: $("pf-" + key + "-paid").checked, paidDate: g("paidDate"), notes: g("notes") };
  }

  function renderPermits() {
    var voided = permits.filter(function (p) { return p.status === "Voided"; });
    var rows = permits.filter(function (p) { return showVoided || p.status !== "Voided"; });
    $("showVoidWrap").classList.toggle("hide", !voided.length);
    $("showVoidTxt").textContent = "Show " + voided.length + " voided";
    $("newPermit").innerHTML = editing === "new" ? editorHtml("new", blankForm()) : "";
    $("permitBody").innerHTML = rows.map(function (p) {
      var isVoid = p.status === "Voided";
      var acts = isVoid
        ? '<button class="btn b-out sm" type="button" data-act="restore">Restore</button>'
        : '<button class="btn b-out sm" type="button" data-act="edit">' + (editing === p.rid ? "Close" : "Edit") + "</button>" +
          '<button class="btn b-out sm" type="button" data-act="void" title="Does not apply to this job">Not applicable</button>';
      var html = '<tr data-permit="' + p.rid + '"' + (isVoid ? ' class="void"' : "") + ">" +
        '<td><div class="nm">' + esc(p.type || "—") + "</div>" + (p.title && p.title !== p.type ? '<div class="sub">' + esc(p.title) + "</div>" : "") +
          (p.notes ? '<div class="sub" style="max-width:380px">' + esc(p.notes) + "</div>" : "") + "</td>" +
        "<td>" + pill(isVoid ? "Voided — does not apply" : p.status, R.permitTone(p.status)) + "</td>" +
        '<td class="sm">' + esc(p.number || "—") + "</td>" +
        '<td class="sm num">' + fmtDate(p.submitted) + '</td><td class="sm num">' + fmtDate(p.approved) + '</td><td class="sm num">' + fmtDate(p.expires) + "</td>" +
        '<td class="sm num">' + (p.fee ? money(p.fee) + (p.paid ? " · paid" : "") : "") + "</td>" +
        '<td><div class="row-acts">' + acts + "</div></td></tr>";
      if (editing === p.rid) {
        html += '<tr data-permit="' + p.rid + '"><td colspan="8" style="padding:0">' +
          editorHtml(p.rid, { type: p.type, title: p.title, status: p.status, number: p.number, submitted: p.submitted, approved: p.approved,
            expires: p.expires, fee: p.fee ? String(p.fee) : "", paid: p.paid, paidDate: p.paidDate, notes: p.notes }) + "</td></tr>";
      }
      if (voiding === p.rid) {
        html += '<tr data-permit="' + p.rid + '"><td colspan="8" style="padding:0"><div class="form">' +
          '<label class="lb s2" for="void-' + p.rid + '">Why does "' + esc(p.type) + '" not apply to this job?' +
          '<input class="in" id="void-' + p.rid + '" placeholder="e.g. MHU replacement, no roofing work" /></label>' +
          '<div class="acts" style="align-self:end"><button class="btn b-red" type="button" data-act="void-save">Mark Voided</button>' +
          '<button class="btn b-out" type="button" data-act="void-cancel">Cancel</button></div></div></td></tr>';
      }
      return html;
    }).join("");
    $("permitEmpty").textContent = permits.length ? "Every permit on this job is voided." : "No permits on this job yet. Press + Add permit.";
    $("permitEmpty").classList.toggle("hide", rows.length > 0);
    $("permitFoot").textContent = voided.length && !showVoided ? voided.length + " permit(s) marked as not applying are hidden." : "";
    $("permitFoot").classList.toggle("hide", !(voided.length && !showVoided));
  }

  function savePermit(key) {
    var permitRid = key === "new" ? null : Number(key);
    var out = R.permitRecord(readEditor(key), { choices: choices, jobRid: job.rid, permitRid: permitRid });
    var errBox = $("pf-" + key + "-errs");
    if (out.errors.length) { errBox.textContent = out.errors.join(" "); return; }
    errBox.textContent = "";
    if (busy) return;
    busy = true;
    qbSave(T.permits, out.record, (permitRid ? "Edit permit #" + permitRid : "Add permit") + ": " + out.record[F.permit.type]).then(function (rid) {
      if (rid) { toast(permitRid ? "Permit saved" : "Permit added", out.record[F.permit.type]); editing = null; return loadJob(); }
    }).catch(function (e) { errBox.textContent = "Could not save: " + e.message; })
      .then(function () { busy = false; });
  }
  function voidPermit(rid, undo) {
    var p = permits.find(function (x) { return x.rid === rid; });
    var reason = undo ? "" : ($("void-" + rid) || {}).value || "";
    var out = R.voidRecord({ permitRid: rid, undo: undo, reason: reason, notes: p.notes, date: R.today(), who: me });
    if (out.error) { toast("Not saved", out.error, true); return; }
    if (busy) return;
    busy = true;
    qbSave(T.permits, out.record, (undo ? "Restore " : "Void ") + p.type + " (#" + rid + ")").then(function (saved) {
      if (saved) { toast(undo ? "Permit restored" : "Marked as not applying", p.type); voiding = null; return loadJob(); }
    }).catch(function (e) { toast("Could not save", e.message, true); })
      .then(function () { busy = false; });
  }

  // ── events ──────────────────────────────────────────────────────────────
  function wire() {
    $("jobSearch").addEventListener("input", renderJobList);
    $("showClosed").addEventListener("change", renderJobList);
    $("jobSelect").addEventListener("change", function () { pickJob(this.value); });

    $("reqBody").addEventListener("change", function (e) {
      var tr = e.target.closest("tr[data-req]");
      if (!tr) return;
      var reqId = tr.getAttribute("data-req");
      if (e.target.classList.contains("req-state")) setRequirement(reqId, e.target.value, e.target);
      if (e.target.classList.contains("req-file")) {
        var def = R.REQS.find(function (x) { return x.id === reqId; });
        uploadDoc(e.target.files[0], def.name, null, "").then(function () { e.target.value = ""; });
      }
    });

    R.DOC_TYPES.forEach(function (t) { $("upType").insertAdjacentHTML("beforeend", "<option>" + esc(t) + "</option>"); });
    $("upBtn").addEventListener("click", function () {
      var btn = this;
      btn.disabled = true;
      uploadDoc($("upFile").files[0], $("upType").value, $("upPermit").value, $("upNote").value).then(function (ok) {
        btn.disabled = false;
        if (ok || !WRITE_ENABLED) { $("upFile").value = ""; $("upNote").value = ""; }
      });
    });

    $("addPermit").addEventListener("click", function () { editing = editing === "new" ? null : "new"; voiding = null; renderPermits(); });
    $("showVoid").addEventListener("change", function () { showVoided = this.checked; renderPermits(); });
    function onPermitClick(e) {
      var btn = e.target.closest("button[data-act]");
      if (!btn) return;
      var act = btn.getAttribute("data-act");
      var ed = btn.closest("[data-editor]");
      var tr = btn.closest("tr[data-permit]");
      var rid = tr ? Number(tr.getAttribute("data-permit")) : null;
      if (act === "save" && ed) return savePermit(ed.getAttribute("data-editor"));
      if (act === "cancel") { editing = null; return renderPermits(); }
      if (act === "edit") { editing = editing === rid ? null : rid; voiding = null; return renderPermits(); }
      if (act === "void") { voiding = rid; editing = null; renderPermits(); var inp = $("void-" + rid); if (inp) inp.focus(); return; }
      if (act === "void-cancel") { voiding = null; return renderPermits(); }
      if (act === "void-save") return voidPermit(rid, false);
      if (act === "restore") return voidPermit(rid, true);
    }
    $("permitBody").addEventListener("click", onPermitClick);
    $("newPermit").addEventListener("click", onPermitClick);
  }

  // ── start ───────────────────────────────────────────────────────────────
  function start() {
    var tag = $("modeTag");
    tag.textContent = WRITE_ENABLED ? "Live" : "Test mode";
    tag.className = "mode" + (WRITE_ENABLED ? "" : " test");
    wire();
    var wanted = null;
    try { wanted = new URLSearchParams(location.search).get("job"); } catch (e) { /* old browser */ }
    Promise.all([
      loadJobs(),
      fieldChoices(T.permits).then(function (c) {
        choices = { types: c[F.permit.type] || [], statuses: c[F.permit.status] || [] };
      }).catch(function () { /* free-text inputs instead of dropdowns */ }),
      whoAmI().then(function (n) { me = n; })
    ]).then(function () {
      defaultBanner();
      if (wanted && !jobs.some(function (j) { return String(j.rid) === String(wanted); })) {
        banner("Job #" + esc(wanted) + " is not a Pinellas job (or you can't see it).", "bad");
        wanted = null;
      }
      if (wanted) job = { rid: Number(wanted) };
      renderJobList();
      if (wanted) pickJob(wanted);
    }).catch(function (e) {
      $("jobSelect").innerHTML = '<option value="">Not connected</option>';
      banner("Could not reach Quickbase (" + esc(e.message) + "). Open this page inside Quickbase as a code page.", "bad");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
