# Checklist

Plan and progress for Phase 5: Decision-Maker Contact Discovery.
Each unit follows the loop in `docs/working-style.md`: branch → build → test → push → merge → delete branch → tick here.

Status: `[ ]` not started · `[~]` in progress · `[x]` done and merged

## Phase 5 — Decision-Maker Discovery (Person-Level Email)

Decisions: Target Founder, CEO, CTO, and other top-level decision-makers. Fallback to generic company email if no personal email is found. Track sent leads by `company_number + email` to allow multiple leads per company. Do not break existing outreach pipelines. Do not use external paid APIs.

| # | Unit | What it does | Files | Test | Status |
|---|------|--------------|-------|------|--------|
| 5.1 | Tracking Fix | Modify sent-lead tracking logic to use `company_number` + `email` composite identity. Update `moveLeadToSent` and `getPendingLeads`. | `src/outreach/csv.js` | Unit test: one person sent doesn't exclude others in same company | [x] |
| 5.2 | Schema Update | Update `leads.csv` generation logic to include new columns (`person_name`, `job_title`, `contact_type`, `email_source_url`, `role_source_url`, `pattern_detected`, `pattern_sample_count`, `pattern_confidence`, `verification_status`, `fallback_used`) while keeping existing columns intact. | `src/enrich/leads.js` | Unit test: backwards compatibility preserved | [x] |
| 5.3 | People Discovery | Enhance scraper and extraction to discover decision-makers from public pages, matching them with CH API officers. | `src/enrich/extract.js`, `src/enrich/officers.js` | Unit test: exact role and name extracted | [x] |
| 5.4 | Pattern Engine | Build logic to collect public employee emails, detect patterns (`first.last@domain`), infer decision-maker emails, and run verification (Syntax/DNS/MX). | `src/enrich/pattern.js` (new) | Unit test: detects pattern correctly, handles uncertainty | [x] |
| 5.5 | Fallback Logic & E2E | Wire the pipeline in `enrich/index.js`. Save qualified person leads, or apply generic company email fallback (`info@`) if none found. | `src/enrich/index.js` | E2E run against real companies | [x] |
