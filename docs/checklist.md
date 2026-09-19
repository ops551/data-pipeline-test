# Checklist

Plan and progress for the Companies House → CSV collector. One row per unit.
Each unit follows the loop in `docs/working-style.md`: branch → build → test →
push → merge → delete branch → tick here.

Status: `[ ]` not started · `[~]` in progress · `[x]` done and merged

## Phase 0 — Project docs

| # | Unit | What it does | Files | Test | Status |
|---|------|--------------|-------|------|--------|
| 0.1 | Working docs | Rewrite `working-style.md` for this project, create this checklist, commit and push | `docs/working-style.md`, `docs/checklist.md`, `CLAUDE.md`, `.gitignore` | Files committed, `.env` not in git | [x] |
| 0.2 | Roadmap | Write `docs/path.md`: all phases (0–5), inputs/outputs, open decisions | `docs/path.md` | File committed, phases match `CLAUDE.md` scope | [x] |

## Phase 1 — Companies House collector

Decisions: no filters, max 1000 new companies per run, never collect a
company already in `companies.csv`.

| # | Unit | What it does | Files | Test | Status |
|---|------|--------------|-------|------|--------|
| 1.0 | Verify API docs | Read the official Companies House API docs. Confirm: search endpoint for incorporation date range, auth method, paging params, page size limit, rate limit. Write findings in the Notes section below. No code | `docs/checklist.md` | A real request with the `.env` key returns 200 | [x] |
| 1.1 | Project setup | `package.json` (Node, `dotenv` only), `.env.example`, `src/` folder skeleton, `npm test` and `npm start` scripts, README install/run commands, `companies.csv` added to `.gitignore` | `package.json`, `.env.example`, `.gitignore`, `README.md`, `src/index.js` | `npm test` runs, `npm start` prints a placeholder | [x] |
| 1.2 | Config | Read `COMPANIES_HOUSE_API_KEY`, date range (`INCORPORATED_FROM`, `INCORPORATED_TO`, or `DAYS_BACK`), `MAX_RESULTS` (default 1000) from `.env`; fail clearly if key is missing. No filter options | `src/config.js`, `.env.example` | Unit test: defaults, date maths, missing key error | [ ] |
| 1.3 | API client | Call the endpoint confirmed in 1.0 with the confirmed auth. Handle 401, 429 (wait and retry), 5xx (retry with backoff), network errors | `src/companiesHouse.js` | Unit test with a mocked `fetch` for 200 / 429 / 500; real call with `.env` key returns rows | [ ] |
| 1.4 | Pagination + dedupe | Loop over pages until `MAX_RESULTS` new companies collected or no more results. Skip a `company_number` seen in this run or passed in as already collected | `src/collect.js` | Unit test: page loop stops at cap, stops at empty page, duplicates and already-seen skipped | [ ] |
| 1.5 | CSV read + append | Read existing `companies.csv` into a set of `company_number`s. Append new rows with `company_number`, `company_name`, `date_of_creation`, `company_status`, `company_type`, `sic_codes`, `registered_office_address` (flattened). Header only when file is new. Proper quoting, no extra dependency | `src/csv.js` | Unit test: quoting, commas/newlines in names, address flattening, read-back of numbers, header written once | [ ] |
| 1.6 | End-to-end run | Wire config → csv read → client → collect → csv append in `src/index.js`, progress logging, README "project structure" and "how it works" sections | `src/index.js`, `README.md` | `npm start` with real key produces `companies.csv`; run again, only new companies are added; eyeball the file | [ ] |

## Not in scope (Phase 2, later)

Google Maps / Search, web scraping, email or WhatsApp discovery, social media,
AI research, contact enrichment, lead scoring. None of this is built now.

## Notes

### Unit 1.0 — Companies House API, verified 2026-09-19

Source: developer-specs.company-information.service.gov.uk (official) plus one
real request with the `.env` key (HTTP 200).

- **Base URL:** `https://api.company-information.service.gov.uk`
- **Endpoint:** `GET /advanced-search/companies`
- **Auth:** HTTP Basic. Username = API key, password = empty.
  Header form: `Authorization: Basic base64("<key>:")`.
- **Query params used:**
  - `incorporated_from`, `incorporated_to` — dates `YYYY-MM-DD`, inclusive
  - `size` — results per page, docs say range 1 to 5000
  - `start_index` — offset of the first result (0-based)
  - No other filter is sent. Nahid's decision: collect everything.
- **Response shape:** `{ etag, top_hit, items: [...], kind, hits }`.
  `hits` is the total match count for the range. Each item has:
  `company_name`, `company_number`, `company_status`, `company_type`,
  `kind`, `links.company_profile`, `date_of_creation`,
  `registered_office_address { address_line_1, address_line_2, locality,
  region?, postal_code, country }`, `sic_codes` (array of strings).
  `date_of_cessation` appears only on dissolved companies.
- **Rate limit:** 600 requests per 5 minutes per key. Over the limit returns
  `429 Too Many Requests`. Live responses also carry headers
  `x-ratelimit-limit`, `x-ratelimit-remain`, `x-ratelimit-reset` (unix
  seconds), `x-ratelimit-window` (`5m`). The client uses `x-ratelimit-reset`
  to know how long to wait on a 429.
- **Sample:** 7-day range on 2026-09-19 reported `hits: 15059`, so a 1000 cap
  is reached in one or two pages at `size=500`.
