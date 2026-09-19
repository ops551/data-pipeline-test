# Checklist

Plan and progress for the Companies House → CSV collector. One row per unit.
Each unit follows the loop in `docs/working-style.md`: branch → build → test →
push → merge → delete branch → tick here.

Status: `[ ]` not started · `[~]` in progress · `[x]` done and merged

## Phase 0 — Project docs

| # | Unit | What it does | Files | Test | Status |
|---|------|--------------|-------|------|--------|
| 0.1 | Working docs | Rewrite `working-style.md` for this project, create this checklist, commit and push | `docs/working-style.md`, `docs/checklist.md`, `CLAUDE.md`, `.gitignore` | Files committed, `.env` not in git | [x] |

## Phase 1 — Companies House collector

| # | Unit | What it does | Files | Test | Status |
|---|------|--------------|-------|------|--------|
| 1.1 | Project setup | `package.json` (Node, `dotenv` only), `.env.example`, `src/` folder skeleton, `npm test` and `npm start` scripts, README run instructions | `package.json`, `.env.example`, `.gitignore`, `README.md`, `src/index.js` | `npm test` runs, `npm start` prints a placeholder | [ ] |
| 1.2 | Config | Read `COMPANIES_HOUSE_API_KEY`, date range (`INCORPORATED_FROM`, `INCORPORATED_TO` or `DAYS_BACK`), `MAX_RESULTS`, `PAGE_SIZE` from `.env` with sane defaults; fail clearly if key is missing | `src/config.js`, `.env.example` | Unit test: defaults, date maths, missing key error | [ ] |
| 1.3 | API client | Verify current official docs first. Call the advanced company search endpoint with HTTP Basic auth (key as username). Handle 401, 429 (rate limit: wait and retry), 5xx (retry with backoff), network errors | `src/companiesHouse.js` | Unit test with a mocked `fetch` for 200 / 429 / 500; real call with `.env` key returns rows | [ ] |
| 1.4 | Pagination + dedupe | Loop over `start_index` pages until `MAX_RESULTS` reached or no more results; drop repeats by `company_number` | `src/collect.js` | Unit test: page loop stops correctly, duplicates removed | [ ] |
| 1.5 | CSV export | Write `companies.csv` with `company_number`, `company_name`, `date_of_creation`, `company_status`, `company_type`, `sic_codes`, `registered_office_address` (flattened). Proper quoting, no extra dependency | `src/csv.js` | Unit test: quoting, commas/newlines in names, address flattening | [ ] |
| 1.6 | End-to-end run | Wire config → client → collect → csv in `src/index.js`, progress logging, README "how it works" section | `src/index.js`, `README.md` | `npm start` with real key produces a valid `companies.csv`; open and eyeball it | [ ] |

## Not in scope (Phase 2, later)

Google Maps / Search, web scraping, email or WhatsApp discovery, social media,
AI research, contact enrichment, lead scoring. None of this is built now.

## Notes

- Phase 1 units are a draft based on `CLAUDE.md`. Nahid will confirm or
  adjust before Unit 1.1 starts.
- Companies House rate limit is 600 requests per 5 minutes per key; the
  client must respect it.
