# Path

The full roadmap, phase by phase. `docs/checklist.md` tracks the units of
the phase currently being built. This file is the big picture: what each
phase is for, what it needs from the phase before, and what it must not do.

Only **Phase 1 is being built now.** Everything after it is planned, not
started. `CLAUDE.md` forbids implementing Phase 2+ features until Phase 1 is
merged and Nahid says go.

```
Phase 0  docs
Phase 1  Companies House  →  companies.csv          (now)
Phase 2  companies.csv    →  contacts (website, phone, email, socials)
Phase 3  contacts         →  qualified, scored leads
Phase 4  leads            →  outreach-ready exports
Phase 5  run it on a schedule, only new companies each time
```

Each phase reads the previous phase's CSV and writes a new one. No phase
edits an earlier phase's output. That keeps every step re-runnable on its own.

---

## Phase 0 — Project docs  `[x]`

Working style, checklist, this path file, `CLAUDE.md`, `.gitignore`.

Done when: docs are on `main` and `.env` is ignored.

---

## Phase 1 — Companies House collector  `[ ] now`

**Goal.** Pull recently incorporated UK companies from the official Companies
House API and write them to `companies.csv`.

**Input.** `.env` with `COMPANIES_HOUSE_API_KEY`, a date range, a result cap.

**Output.** `companies.csv` with only fields Companies House actually returns:
`company_number`, `company_name`, `date_of_creation`, `company_status`,
`company_type`, `sic_codes`, `registered_office_address` (flattened).

**Units.** See `docs/checklist.md` Phase 1 (setup → config → API client →
pagination + dedupe → CSV → end-to-end run).

**Rules.** Only the Companies House API. No other service. No scraping.
`dotenv` is the only dependency. Respect the 600 requests / 5 minutes limit.

**Done when.** `npm start` with a real key produces a correct
`companies.csv`, `npm test` is green, all six units merged and branches
deleted.

**Open decisions for Nahid before 1.1 starts.**
- Date range: fixed `from/to` dates, or "last N days", or both?
- Filter by `company_status` (active only) and `company_type` (ltd only)?
- Filter by SIC code from the start, or collect everything and filter later?
- Result cap default (e.g. 500? 5,000?).

---

## Phase 2 — Contact discovery  `[ ] later`

**Goal.** For each row in `companies.csv`, find how to reach the company:
website, phone, email, WhatsApp-capable number, social profiles.

**Input.** `companies.csv`.

**Output.** `contacts.csv` — same `company_number` key plus contact columns,
each with a `source` column so it is clear where every value came from.

**Likely units.**
- 2.1 Read `companies.csv`, define the `contacts.csv` schema.
- 2.2 Google Places / Maps lookup by company name + registered address →
  website, phone, maps listing.
- 2.3 Google Search fallback when Maps has nothing → website URL.
- 2.4 Website crawl (home, contact, about pages) → emails, phone numbers,
  social links. Polite: respect `robots.txt`, one request at a time, cache
  pages on disk so re-runs are free.
- 2.5 Normalise UK phone numbers to E.164 and flag mobiles (07xxx) as
  WhatsApp candidates. No WhatsApp API calls, just number format.
- 2.6 Merge everything into `contacts.csv`, run cost + hit-rate report.

**Rules.**
- Every external API key comes from `.env`. Never hardcoded.
- Cache every API response and fetched page locally. Re-running must not
  re-pay for the same company.
- Brand-new companies often have no web presence yet. Expect a low hit rate;
  a company with no contact found is still kept in the file, just empty.

**Open decisions.**
- Which sources to pay for: Google Places API costs money per lookup.
- Hunter / Clearbit style email APIs, or website-only email discovery?
- How many days after incorporation before a company is worth looking up?

---

## Phase 3 — Qualification and scoring  `[ ] later`

**Goal.** Turn `contacts.csv` into a ranked list worth Nahid's time.

**Input.** `contacts.csv`.

**Output.** `leads.csv` — filtered, scored, with a short "why" per row.

**Likely units.**
- 3.1 Hard filters: status active, wanted SIC codes, wanted regions
  (postcode area), exclude dormant / dissolved.
- 3.2 Rule-based score: has website, has email, has mobile, SIC match,
  days since incorporation.
- 3.3 Optional AI research: one short summary per company from its website
  ("what they do, who they serve"). Batched, cached, cost-capped.
- 3.4 `leads.csv` export sorted by score.

**Open decisions.**
- What Nahid is actually selling, which decides the SIC codes and score
  weights. This phase cannot be designed properly until that is answered.

---

## Phase 4 — Outreach-ready export  `[ ] later`

**Goal.** Get `leads.csv` into whatever tool Nahid sends messages from.

**Likely units.**
- 4.1 Google Sheets push (append new leads, never overwrite the sheet).
- 4.2 Message templates filled per lead (email, WhatsApp text) as columns.
- 4.3 Optional CRM export (HubSpot / Notion / whatever is chosen).

**Rules.**
- This project prepares the data. It does **not** send messages itself.
- UK GDPR and PECR apply to B2B marketing. Keep a `source` and a
  `collected_at` per contact so opt-out and "where did you get this" can be
  answered. Never message a number or email that was not found publicly.

---

## Phase 5 — Scheduling and incremental runs  `[ ] later`

**Goal.** Run the whole pipeline automatically and only process companies not
seen before.

**Likely units.**
- 5.1 `seen.json` (or SQLite) of processed `company_number`s; Phase 1 skips
  them.
- 5.2 Date range defaults to "since last successful run".
- 5.3 One command runs Phase 1 → 2 → 3 → 4 in order, stops on first failure.
- 5.4 Cron / GitHub Actions schedule, run log, failure notification.

---

## Dependencies between phases

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4
                                        │
Phase 5 wraps all of the above ◄────────┘
```

- Phase 2 cannot start until Phase 1's CSV schema is final.
- Phase 3 needs Nahid's answer on "what are we selling" (see Phase 3).
- Phase 5 is last; it only automates what already works by hand.

## What is never built

Anything that sends unsolicited messages automatically, scrapes personal
(not business) data, or bypasses a site's `robots.txt` / rate limits.
