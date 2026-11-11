# Plan

Based on two docs in the shared `Pinellas Project` folder (not in this repo):

- *New Assignment System, US Programs (Pinellas First)*, Nov 10, 2026
- *Assignment Automation Plan – Pinellas First*, Nov 12, 2026

## The most important rule: 90 days

We have 90 days from the day BDO assigns a job to get the NTP (BDO's OK to start building). Late jobs can be taken away. There's a second clock: precon must be done 90 days after the Work Order (PWO) is issued. The system tracks both.

## Where the work lives

| Tool | Job |
| --- | --- |
| Quickbase | Holds every job and does the deadline math |
| Quickbase code page | Where people upload the job CSV |
| n8n | Moves things between apps after a job exists (Drive folder, messages, reminders) |
| AI | Reads messy documents and writes drafts. A person always approves |

## Order of work

1. **Set up the repo.** Done.
2. **Get the template.** Final column list, then map each column to a Quickbase field.
3. **Checking rules.** Required columns filled, award type is MHU / Rehab / Recon, dates are real dates, Case ID not already in Quickbase.
4. **Upload page.** Upload → check → preview → confirm → create jobs. Built switched off.
5. **Test** on the Mularz test job, then switch on.
6. **Next steps:** Drive folder, task list, the yes/no questions (arborist letter, park rules, permit needed), homeowner messages.

## Upload rules

- **No duplicates.** Case ID is the key. Uploading the same file twice creates nothing new.
- **Bad rows are rejected with a reason** ("row 4: GC assignment date is missing"). Good rows still go in.
- **Preview before saving.** Nothing is written until the person confirms.

## Open questions

- Final template columns (waiting on the files).
- Who can use the upload page (which Quickbase roles).
- Does BDO's Canopy feed cover Pinellas? If yes, jobs could come straight from Canopy later.
