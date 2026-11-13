# Job Setup page

A Quickbase code page where people type new jobs into a spreadsheet-style table and create them in bulk.

## How it works

1. People type one job per row. Job Type, Program, State and Status are dropdowns. New rows start with Program = Pinellas Recovers Program, State = Florida, Status = OPEN.
2. They can also paste rows copied from Excel or Google Sheets (header rows are skipped), or load a filled-in template CSV. Both land in the same table.
3. Every row is checked as they go: required columns, Job Type, Program, State, Zip, Status, price, phone and email. A row's problems turn red once they leave that row.
4. Inside Quickbase it also checks, as they go, for jobs that already exist (exact Job Name or the same case number, for example `PC-HRRP-176424`) and for homeowners that already exist (by email).
5. **Create** confirms first, then for each ready row creates the homeowner in **Owners** (or reuses the existing one), then the job in **Jobs**, linked by Related Owner (197) and Program (Link) (1814). Rows with problems are skipped.

## Where each column goes

| Template column | Table | Field |
| --- | --- | --- |
| Job Name * | Jobs | 6 Job Name (unique) |
| Job Type * | Jobs | 34 Job Type ("Rehab" and "Recon" accepted) |
| Program * | Jobs | 490 Program, plus 1814 Program (Link) looked up by name |
| Address - Street 1 * | Jobs | 8 |
| Address - City * | Jobs | 10 |
| Address - Zip * | Jobs | 12 |
| Address - State * | Jobs | 11 (FL or Florida, saved as Florida) |
| Status | Jobs | 35 (blank = OPEN) |
| Original Contract Price | Jobs | 41 |
| Homeowner Name * | Owners | 6 Owner |
| Phone Number | Owners | 7 |
| Email | Owners | 8 (also used to find an existing homeowner) |

The homeowner also gets the job address (Owners 10, 12, 13, 14).

## Test mode

`WRITE_ENABLED` at the top of `app.js` is `false`. In test mode the page does every check and shows what it would create, but saves nothing. Switch it on only after the Mularz test run.

## Build and deploy

```
npm test                 # checking rules
npm run build:preview    # dist/job-setup.preview.html, no token, for a local look
npm run build            # dist/job-setup.html, needs QB_APP_TOKEN in env or .env
```

Deploy `dist/job-setup.html` as a code page with `API_AddReplaceDBPage`. The app token only exists in `dist/` and `.env`, which Git ignores.

## Files

- `page.html`: layout and styles (from the Purchase Entry bulk upload design)
- `rules.js`: reading and checking, no network (tested in `test/rules.test.js`)
- `app.js`: page behaviour and Quickbase calls
- `shim.js`: QB-SESSION-SHIM v2, copied from `invoice_doc_upload.html`, token replaced by a placeholder
