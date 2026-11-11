# Pinellas Automation

Automation for Byrdson's **Pinellas Recovers** jobs (BDO is the client).

The goal: when BDO gives us a new job, the system does the setup work (opens the job in Quickbase, starts the deadlines, gives each person their tasks, contacts the homeowner, and warns us when something is late). People still do the hands-on work and the approvals.

See [docs/plan.md](docs/plan.md) for the plan in plain English.

## How jobs come in (first version)

1. Someone fills in the job template and saves it as a CSV.
2. They upload it on a **page inside Quickbase**.
3. The page checks every row and shows a preview. Nothing is saved yet.
4. They confirm, and the page creates the jobs in Quickbase.

The page runs as the signed-in Quickbase user, so no password or access key is stored in the page.

## What's in this repo

| Folder | What it holds |
| --- | --- |
| `docs/` | The plan and decisions, in plain English |
| `quickbase/pages/` | Quickbase code pages (the upload page lives here) |
| `templates/` | Blank CSV templates and what each column means |
| `samples/` | **Fake** test files only |
| `n8n/` | Saved copies of n8n workflows, for steps after a job exists |

## Rules for this repo

- **No real homeowner data.** Real CSVs never go in Git. Only blank templates and made-up samples.
- **No passwords, tokens or keys.** They live in Quickbase, n8n credentials or a local `.env` that Git ignores.
- **Everything is built switched off**, tested on the Mularz test job, then switched on.

## Status

Repo set up. Waiting on the job template files before building the upload page.
