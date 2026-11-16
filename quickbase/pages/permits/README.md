# Permits page

A Quickbase code page for working a Pinellas job's permits in one place. It is the **Permits tab of the Florida Assignments app**, rebuilt as a code page. Both write the same Quickbase rows, so a change made in either one shows in the other.

Open it with `?a=dbpage&pagename=permits.html`, and add `&job=<record id>` to open a job straight away (the page puts it in the address bar when you pick one).

## What's on it

1. **Permit requirements.** The checklist from the team's *Pinellas Recovers Permit Requirements Check.xlsx* (28 items: 10 Reconstruction, 9 Rehabilitation, 9 MHU). Each item shows who provides it, whether the sources confirm it, and the condition it applies under. Per job, each item is **Needed**, **Received** or **Not needed** (Not needed asks why). Each item has its own Upload button; the file is listed under the item.
2. **Permit documents.** Every file on the job with category "Permits", plus an upload form (document type, optional permit, note).
3. **Permits on this job.** The job's rows in US Permits: edit, add, and **Not applicable** (the row is set to Voided with the reason in its notes, never deleted). Voided rows are hidden until you tick "Show voided", and can be restored.

Job types other than MHU, Rehabilitation and Reconstruction (for example Home Elevation) have no checklist; the documents and permits sections still work.

## Where it saves

| What | Table | Fields |
| --- | --- | --- |
| Checklist state | PreConstruction Activities `bv68x62x6` | One row per item: 6 Template ID (`PR-R01`…), 12 Status (Not Started = Needed, Complete = Received, N/A = Not needed), 14 completed date, 15 notes, 17 job, 42 Workflow Version `FL-ASSIGN-1`, 44 Generation Key `job|PR-xxx` |
| Documents | Attachments `buskqh28a` | 10 file, 16 description, 20 file name, 21 job, 53 Category - Job = "Permits" |
| Permits | US Permits `bu5cvf3js` | 6 type, 36 description, 10 status, 9 number, 7 submitted, 8 issued, 11 expires, 46 fee, 47 paid, 48 paid on, 19 notes, 15 job |

A file for a checklist item has a description that **starts with the item's name**; that is how the item finds its files. Files are saved to Quickbase only (a code page cannot reach Google Drive); the Florida Assignments app's nightly sweep copies Quickbase files on Florida jobs into the job's Drive folder.

Type and status dropdowns come from the US Permits table's own choice lists (the shared shim now returns field choices).

## Test mode

`WRITE_ENABLED` at the top of `app.js` is `false`. In test mode the page reads everything from Quickbase, and each button shows what it would save (the full record goes to the browser console), but nothing is written. Switch it on after the Mularz test run.

## Build and deploy

```
npm test                         # rules, including test/permits.test.js
npm run build:preview            # dist/permits.preview.html, no token
npm run build                    # dist/permits.html, needs QB_APP_TOKEN
```

Deploy `dist/permits.html` as a code page with `API_AddReplaceDBPage`.

## Files

- `page.html`: layout and styles (same look as Job Setup)
- `rules.js`: the checklist and the save rules, no network (tested in `test/permits.test.js`)
- `app.js`: page behaviour and Quickbase calls
- `../shared/shim.js`: QB-SESSION-SHIM v2, shared by every page
