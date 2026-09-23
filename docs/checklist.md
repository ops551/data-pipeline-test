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

Decisions: email is the main target, WhatsApp-capable mobile second, everything
free, companies 30–60 days old, drop any company that has a website. A phone
found in 2.4 does not end the search: the company still goes through 2.5–2.6
for email. Full plan in
`docs/path.md`. Open: Google Cloud card (decides 2.4), final SIC list (2.2).

| # | Unit | What it does | Files | Test | Status |
|---|------|--------------|-------|------|--------|
| 2.0 | Hit-rate test | No product code. Pull 30 companies each at 7, 30 and 60 days old with Phase 1 (`INCORPORATED_FROM/TO`). Check each by hand or with the free search quota: any Maps listing, social page or directory entry? Record hits per age in Notes. Decides the age window | `docs/checklist.md` | Table of hits per age written in Notes | [x] |
| 2.1 | Scope update | Rewrite `CLAUDE.md`, `GEMINI.md` to allow web scraping for Phase 2. Update working style to reflect Gemini does NOT push. Update `.gitignore` | `CLAUDE.md`, `GEMINI.md`, `docs/path.md`, `docs/checklist.md`, `docs/working-style.md`, `.gitignore` | Docs reviewed by Nahid | [x] |
| 2.2 | Candidate filter | Read `companies.csv`, keep 7-60 days window, keep target SIC list, drop SPV/holding/dormant SICs, flag formation-agent addresses. Write `candidates.csv`. Skip numbers already in `enriched.csv` | `src/enrich/filter.js`, `src/enrich/sic.js` | Unit tests: window, SIC include/exclude, agent-address flag | [x] |
| 2.3 | Officers | `GET /company/{number}/officers` (free). Take active directors' names into candidates. Reuse `companiesHouse.js` auth | `src/companiesHouse.js`, `src/enrich/officers.js` | Unit test with mocked fetch; real call for one company | [ ] |
| 2.4 | Scraping Setup | Install `puppeteer` (or `playwright`) and any stealth plugins needed to scrape Google/DuckDuckGo. Create a utility module that can open a headless browser and run searches. | `package.json`, `src/enrich/scraper.js` | Browser opens, searches "test", returns HTML/links | [ ] |
| 2.5 | Search & Social Extraction | For each candidate, use scraper to search `company name postcode`. If website found -> `has_website`, skip. Otherwise, grab Facebook, Instagram, LinkedIn, directory URLs. Then visit those URLs directly via scraper to extract emails and mobile numbers using Regex. | `src/enrich/search.js`, `src/enrich/extract.js` | Real run for 5 companies extracts emails/phones | [ ] |
| 2.6 | leads.csv | Normalise phones to `+44…`; `whatsapp_candidate = yes` only for `07` mobiles. `status = lead` needs email **or** mobile. Append to `leads.csv` with sources. Record checked in `enriched.csv`. | `src/enrich/leads.js`, `src/enrich/phone.js` | Unit tests: normalisation, status rules | [ ] |
| 2.7 | End-to-end | `npm run enrich` wires 2.2 → 2.6 using Puppeteer. Measure real yield over a few runs. | `src/enrich/index.js`, `package.json`, `README.md` | Real daily runs, yield recorded | [ ] |

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

### Unit 2.0 — Hit-rate test, measured 2026-09-19

Method: 500 companies pulled per age bucket with the Phase 1 script, SPV /
holding SICs and repeated (agent) addresses excluded, 30 sampled at random
per bucket, one web search per company (name + town). Companies House
mirror sites ignored. Conservative: unclear match = no.

| age | n | any presence | website | presence, no website | email seen | phone seen |
|---|---|---|---|---|---|---|
| 7 days | 30 | 5 | 3 | 2 | 1 | 1 |
| 30 days | 30 | 2 | 1 | 1 | 0 | 1 |
| 60 days | 30 | 4 | 4 | 0 | 0 | 0 |
| 6 months | 30 | 6 | 3 | 3 | 0 | 3 |
| 12 months | 30 | 8 | 8 | 0 | 0 | 1 |
| **total** | **150** | **25 (17%)** | **19** | **6 (4%)** | **1** | **6** |

What it means:
- The target company (some footprint, no website) is **4% at every age**.
  Age does not fix it. By 12 months, everyone with a footprint has a website.
- Almost every hit was an existing business that just incorporated, not a
  new venture that went online later.
- Email appeared in a search snippet **once in 150**. Email will only come
  from page fetches (Facebook About, directories), never from snippets.
- Hits cluster in consumer-facing local businesses: takeaway, restaurant,
  bar, garden centre, landscaper. Pure consulting / trading / holding names
  had zero presence.
- Google Maps listings never surfaced in web search snippets; Maps data
  needs the Places API.
- Companies-House-first + free search (100/day) would yield about **4
  no-website companies per day, and roughly 1 email per week**. The
  30-leads-a-day target is not reachable this way. Plan needs a decision
  from Nahid before Unit 2.1.

