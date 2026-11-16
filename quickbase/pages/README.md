# Quickbase code pages

Pages here are deployed into the Construction Management_V2 app as code pages and opened with `?a=dbpage&pagename=<file>.html`.

- **Sign-in:** copy the existing QB-SESSION-SHIM (v2, from `invoice_doc_upload.html` in Quickbase) into each page. It sends calls through the signed-in user's session. Never put a user token in page code.
- **Deploy:** the legacy XML API call `API_AddReplaceDBPage`.

## Pages

| Folder | Page | What it does |
| --- | --- | --- |
| `job-setup/` | `job-setup.html` | Type, paste or load new jobs and create them in bulk |
| `permits/` | `permits.html` | A job's permit checklist, permit documents and US Permits rows |

Each folder has `page.html`, `rules.js` and `app.js`; `npm run build` builds every folder into `dist/`. The shim lives once in `shared/shim.js`.
