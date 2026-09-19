# Path

The roadmap. `docs/checklist.md` tracks the units of the phase being built.
This file is the big picture.

Only **Phase 1 is being built.** Phase 2 is a note for later, nothing more.
`CLAUDE.md` forbids implementing anything from Phase 2 now.

```
Phase 0  docs                                        (done)
Phase 1  Companies House API  →  companies.csv       (now)
Phase 2  contact discovery                           (later, not planned yet)
```

---

## Phase 0 — Project docs  `[x]`

Working style, checklist, this path file, `CLAUDE.md`, `.gitignore`.

---

## Phase 1 — Companies House collector  `[ ] now`

**Goal.** Pull recently incorporated UK companies from the official Companies
House API and write them to `companies.csv`.

**Input.** `.env` with `COMPANIES_HOUSE_API_KEY`, a date range, a result cap.

**Output.** `companies.csv` with only fields Companies House actually returns:
`company_number`, `company_name`, `date_of_creation`, `company_status`,
`company_type`, `sic_codes`, `registered_office_address` (flattened).

**Decisions made by Nahid.**
- **No filters.** Every company in the date range is collected, whatever its
  status, type or SIC code.
- **Max 1000 new companies per run**, then stop. `MAX_RESULTS` in `.env`,
  default 1000.
- **Never collect the same company twice.** `companies.csv` is the memory:
  on start, read the `company_number`s already in it, skip those, append only
  new rows. Deleting the file resets the memory.

**Rules.** Only the Companies House API. No other service. No scraping.
`dotenv` is the only dependency. Respect the 600 requests / 5 minutes limit.
Verify endpoint, auth and query params from the official docs before any code.

**Units.** See `docs/checklist.md` Phase 1 (verify docs → setup → config →
API client → pagination + dedupe → CSV → end-to-end run).

**Done when.** `npm start` with a real key produces a correct
`companies.csv`, a second run adds only companies not already there,
`npm test` is green, all units merged and branches deleted.

---

## Phase 2 — Contact discovery  `[ ] later`

Find website, phone, email, socials for the companies in `companies.csv`.
Not planned in detail yet. Nothing from it is built in Phase 1. It will be
planned in this file only when Phase 1 is finished and Nahid says go.
