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
| 1.2 | Config | Read `COMPANIES_HOUSE_API_KEY`, date range (`INCORPORATED_FROM`, `INCORPORATED_TO`, or `DAYS_BACK`), `MAX_RESULTS` (default 1000) from `.env`; fail clearly if key is missing. No filter options | `src/config.js`, `.env.example` | Unit test: defaults, date maths, missing key error | [x] |
| 1.3 | API client | Call the endpoint confirmed in 1.0 with the confirmed auth. Handle 401, 429 (wait and retry), 5xx (retry with backoff), network errors | `src/companiesHouse.js` | Unit test with a mocked `fetch` for 200 / 429 / 500; real call with `.env` key returns rows | [x] |
| 1.4 | Pagination + dedupe | Loop over pages until `MAX_RESULTS` new companies collected or no more results. Skip a `company_number` seen in this run or passed in as already collected | `src/collect.js` | Unit test: page loop stops at cap, stops at empty page, duplicates and already-seen skipped | [x] |
| 1.5 | CSV read + append | Read existing `companies.csv` into a set of `company_number`s. Append new rows with `company_number`, `company_name`, `date_of_creation`, `company_status`, `company_type`, `sic_codes`, `registered_office_address` (flattened). Header only when file is new. Proper quoting, no extra dependency | `src/csv.js` | Unit test: quoting, commas/newlines in names, address flattening, read-back of numbers, header written once | [x] |
| 1.6 | End-to-end run | Wire config → csv read → client → collect → csv append in `src/index.js`, progress logging, README "project structure" and "how it works" sections | `src/index.js`, `README.md` | `npm start` with real key produces `companies.csv`; run again, only new companies are added; eyeball the file | [x] |

## Phase 2 — Contact discovery

Decisions: email + WhatsApp-capable mobile only, everything free, companies
30–60 days old, drop any company that has a website. Full plan in
`docs/path.md`. Open: Google Cloud card (decides 2.4), final SIC list (2.2).

| # | Unit | What it does | Files | Test | Status |
|---|------|--------------|-------|------|--------|
| 2.0 | Hit-rate test | No product code. Pull 30 companies each at 7, 30 and 60 days old with Phase 1 (`INCORPORATED_FROM/TO`). Check each by hand or with the free search quota: any Maps listing, social page or directory entry? Record hits per age in Notes. Decides the age window | `docs/checklist.md` | Table of hits per age written in Notes | [ ] |
| 2.1 | Scope update | Rewrite `CLAUDE.md` rules 5–7 for Phase 2 scope (search API, public page fetch, Places allowed; still no logins, no scraping behind login walls, no paid APIs). Add new `.env` keys to `.env.example`. `leads.csv`, `candidates.csv`, `enriched.csv`, cache dir in `.gitignore` | `CLAUDE.md`, `.env.example`, `.gitignore`, `docs/path.md` | Docs reviewed by Nahid | [ ] |
| 2.2 | Candidate filter | Read `companies.csv`, keep age window, keep target SIC list (proposed: food, beauty, trades, retail, fitness, cleaning, photography, tutoring…), drop SPV/holding/dormant SICs, flag formation-agent addresses (same address ≥ 20 companies in file). Write `candidates.csv`. Skip numbers already in `enriched.csv` | `src/enrich/filter.js`, `src/enrich/sic.js` | Unit tests: window, SIC include/exclude, agent-address flag | [ ] |
| 2.3 | Officers | `GET /company/{number}/officers` (free, verified in docs first). Take active directors' names into candidates. Reuse `companiesHouse.js` auth and retry | `src/companiesHouse.js`, `src/enrich/officers.js` | Unit test with mocked fetch; real call for one company | [ ] |
| 2.4 | Google Places (if card) | Text search by company name + postcode, free tier only, daily cap in `.env`. Returns phone, website, maps URL. Website found → `has_website`. Cache every response | `src/enrich/places.js` | Unit test with mocked fetch; real call for 5 companies; verify cap stops calls | [ ] |
| 2.5 | Search | Google Custom Search JSON API, 100/day cap. Query `"company name" town`. Collect Facebook, Instagram, LinkedIn, TikTok, Yell, Checkatrade, Maps URLs. Regex email and UK mobile out of titles and snippets. Cache | `src/enrich/search.js`, `src/enrich/extract.js` | Unit tests: URL classification, phone/email regex on sample snippets; real run for 5 companies | [ ] |
| 2.6 | Public page fetch | Fetch only publicly readable pages found in 2.5 (Facebook About, directories). `robots.txt` check, 1 request at a time, 2s gap, disk cache. Regex email and mobile. Never fetch Instagram/LinkedIn (login wall) | `src/enrich/fetchPage.js` | Unit tests: robots check, regex, cache hit; real fetch of 3 pages | [ ] |
| 2.7 | leads.csv | Normalise phones to `+44 7…`, `whatsapp_candidate`, set `status`, append to `leads.csv` with `source` and `collected_at`, record every checked company in `enriched.csv`. Re-check `nothing_found` once after 30 days | `src/enrich/leads.js`, `src/enrich/phone.js` | Unit tests: normalisation, status rules, memory read/write | [ ] |
| 2.8 | End-to-end | `npm run enrich` wires 2.2 → 2.7, stops at daily quota, resumes next day. README section. Measure real yield over 3 days and write it in Notes | `src/enrich/index.js`, `package.json`, `README.md` | 3 real daily runs, no company checked twice, yield recorded | [ ] |

## Not in scope

Anything that logs in to a social network, automated accounts, buying data,
verifying WhatsApp numbers, sending messages, Telegram. Paid APIs only if
Nahid decides later.

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
