# Phase 2 Specification Report: Units 2.3 – 2.7

## Overview & Specification Sources

This document specifies the exact requirements, constraints, API interfaces, data schemas, Git workflows, and acceptance criteria for **Phase 2 (Contact Discovery, Units 2.3 to 2.7)** of the "Recent UK Companies" project.

### Authoritative Sources Examined
1. `ORIGINAL_REQUEST.md`: User dispatch objectives, acceptance criteria, and operational directives.
2. `docs/working-style.md`: Delivery rules, communication style, strict Git rules, PR/merge cycle, and testing loop.
3. `docs/checklist.md`: Unit-level tracking, historical status (Phase 1 and Units 2.0–2.2 done), unit scopes, and verified API notes.
4. `docs/path.md`: Architectural roadmap, pipeline flow, rationale for zero-website filtering, and leads schema.
5. `GEMINI.md` & `CLAUDE.md`: Fundamental project constraints, Node.js environment, forbidden additions (no AI research, no lead scoring), scraping authorization for Phase 2.
6. **Official Companies House API Specification & Live Probe**: Endpoint `GET /company/{company_number}/officers` verified via live API query with authenticated key.
7. **Existing Codebase**: `src/companiesHouse.js`, `src/csv.js`, `src/enrich/filter.js`, `src/enrich/sic.js`, `src/enrich/csvParser.js`, and `.github/workflows/ci.yml`.

---

## Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Officers API | Officers Retrieval | Retrieve company officers via Companies House API | `company_number`, Basic auth | Officer list JSON object | 401 on bad key, 404 if company missing, 429 rate limit (retry), 5xx retry with backoff | Companies House API Spec & Live Probe |
| 2 | Officers API | Active Director Extraction | Filter active officers for directors (`officer_role` contains 'director' and `!resigned_on`) | Officer list items array | Extracted `director_name` (string) | If no active director found, output empty string `""` | `docs/checklist.md`, live probe |
| 3 | Scraping Setup | Headless Browser Management | Launch and manage Puppeteer headless browser instance with stealth settings | Browser launch options (`--no-sandbox`, headless) | Browser instance, clean page creation | Graceful launch failure handling, browser process cleanup | `docs/checklist.md`, `CLAUDE.md` |
| 4 | Search Engine | Company Query Execution | Search DuckDuckGo/Google for company name + postcode/town | `company_name`, `postcode` / `registered_office_address` | Search result URLs, titles, and snippets | Retries, fallback on captcha/block, timeout handling | `docs/path.md`, `docs/checklist.md` |
| 5 | Classification | Own Website Detection | Detect if top search results represent company's own domain vs directory platform | Search result URLs, directory domain blacklist | Boolean flag `has_website` | False if all results are directories/mirrors; True if dedicated domain found | `docs/path.md` |
| 6 | Social Extraction | Social Profile Discovery | Identify and collect URLs for Facebook, Instagram, LinkedIn, Google Maps, and directories | Search result URLs | Extracted profile URLs (`facebook`, `instagram`, `linkedin`, `google_maps`, `other_links`) | Missing links remain empty string `""` | `docs/path.md`, `docs/checklist.md` |
| 7 | Page Scraping | Public Contact Extraction | Visit discovered social/directory pages and extract emails and phone numbers via regex | Target page URLs | Raw email strings, raw phone strings | Skip on login wall/captcha/timeout; no login attempts; empty on failure | `docs/path.md`, `GEMINI.md` |
| 8 | Normalisation | UK Phone Normalisation | Standardise UK phone numbers into international E.164 format (`+44...`) | Raw phone string | Normalised E.164 string | Return empty or unparseable if invalid UK number | `docs/path.md`, `docs/checklist.md` |
| 9 | Classification | WhatsApp Candidate Flag | Flag mobile numbers starting with UK `07` as WhatsApp candidates | Normalised phone number | `whatsapp_candidate`: `'yes'` or `'no'` | Landlines (`01`, `02`, `03`) flagged as `'no'` | `docs/path.md` |
| 10 | Detection | WhatsApp Mentioned Flag | Detect if the keyword "WhatsApp" appeared adjacent to the phone number | Page snippet / text surrounding phone | `whatsapp_mentioned`: `'yes'` or `'no'` | Default to `'no'` if not explicitly mentioned | `docs/path.md` |
| 11 | Qualification | Lead Status Classification | Classify candidate into `lead`, `has_website`, or `nothing_found` | Website detection result, contact discovery result | `status` enum string | Needs email OR mobile to qualify as `lead` | `docs/path.md`, `docs/checklist.md` |
| 12 | Prioritisation | Contact Priority Assignment | Assign lead priority based on available communication channels | `email`, `phone` (mobile) presence | `priority`: `'email+mobile'`, `'email'`, `'mobile'`, or empty | Non-leads receive empty string | `docs/path.md` |
| 13 | Compliance | Contact Provenance Tracking | Store exact origin URL for every scraped email and phone number | Scraped page URL | `email_source`, `phone_source` | Set to empty string if contact is absent | `docs/path.md` (GDPR/PECR) |
| 14 | Output | leads.csv Export | Append qualified leads with all 20 required columns to `leads.csv` | Lead records array | Written CSV rows with headers on creation | Safe CSV quoting, newlines replaced with spaces | `docs/path.md`, `src/csv.js` |
| 15 | Deduplication | enriched.csv Memory Cache | Track evaluated company numbers and timestamps to prevent re-processing | `company_number`, timestamp, status | Updated `enriched.csv` file | Prevents re-querying inside the re-check window | `docs/path.md`, `src/enrich/filter.js` |
| 16 | Pipeline | End-to-End Execution | Orchestrate Units 2.2 through 2.6 via `npm run enrich` CLI script | `companies.csv`, `.env` | Updated `candidates.csv`, `leads.csv`, `enriched.csv` | Informative logging, graceful exit, yield metrics printed | `docs/checklist.md`, `ORIGINAL_REQUEST.md` |

---

## Edge Cases

| # | Feature | Input | Observed / Required Behavior |
|---|---------|-------|------------------------------|
| 1 | Officers API | Company with 0 officers or 404 returned | Return empty array, `director_name` set to `""`. Do not crash pipeline. |
| 2 | Officers API | Company with multiple active directors | Take the first active director, or join active director names (clean formatting). |
| 3 | Officers API | Company with corporate director or secretary | Filter out secretaries (`officer_role === 'secretary'`); keep natural director if present. |
| 4 | Officers API | Officer with `resigned_on` date | Skip resigned officer; only accept officers where `!officer.resigned_on`. |
| 5 | Officers API | Name formatted as `"SURNAME, Forename Middlename"` | Format to standard readable name or preserve cleanly without CSV quote corruption. |
| 6 | Officers API | HTTP 429 Rate Limit | Read `x-ratelimit-reset` header, pause until reset (or fallback 60s), and retry up to 5 times. |
| 7 | Scraper | Search engine returns Cloudflare / Captcha block | Back off, rotate delay or switch search engine (DuckDuckGo vs Google fallback); do not crash. |
| 8 | Scraper | Social page requires login (Facebook / Instagram / LinkedIn wall) | Immediately skip page; do not retry, never attempt authentication. |
| 9 | Scraper | Domain in search result is a directory (e.g. `yell.com`, `wheree.com`) | Do NOT mark as `has_website`; treat company as still eligible for lead generation. |
| 10 | Scraper | Domain in search result is company's own site (e.g. `acmebakery.co.uk`) | Immediately mark `has_website`, set `status = 'has_website'`, and stop contact discovery. |
| 11 | Contact Extraction | Page contains placeholder or bogus email (e.g. `user@domain.com`, `.png`) | Filter out image extensions (`.png`, `.jpg`), generic examples (`example.com`, `wixpress.com`). |
| 12 | Phone Normalisation | Phone formatted with spaces/dashes (e.g. `"07123 456-789"`) | Strip formatting, normalise to `+447123456789`. |
| 13 | Phone Normalisation | UK Landline (e.g. `"020 7946 0991"`) | Normalise to `+442079460991`, set `whatsapp_candidate = 'no'`. |
| 14 | Phone Normalisation | UK Mobile (`07xxx`) | Normalise to `+447xxx`, set `whatsapp_candidate = 'yes'`. |
| 15 | Lead Qualification | Company has landline phone only and no email | Not a WhatsApp candidate, no email -> `status = 'nothing_found'`, not a lead (`status = 'lead'` requires email OR mobile). |
| 16 | Deduplication | Company already present in `enriched.csv` | Filtered out during candidate preparation; skipped in subsequent runs. |

---

## 1. Exact Git Workflow Rules

Per `docs/working-style.md`, `docs/checklist.md`, and project rules:

### Branch Management
- **Naming Convention:** Strictly `phase-<n>-unit-<n>`. For Phase 2 units:
  - Unit 2.3: `phase-2-unit-3`
  - Unit 2.4: `phase-2-unit-4`
  - Unit 2.5: `phase-2-unit-5`
  - Unit 2.6: `phase-2-unit-6`
  - Unit 2.7: `phase-2-unit-7`
- **Origin & State:** Every branch must be cut directly from an up-to-date `main`:
  `git checkout main && git pull origin main && git checkout -b phase-2-unit-<n>`
- **Exclusivity:** Only `main` and the current unit's branch may exist at any time.

### The Build and Test Loop (Step-by-Step)
For every individual unit, execute this loop sequentially:
1. **Plan First:** Confirm unit details in `docs/checklist.md` before writing code.
2. **Branch:** Cut dedicated branch `phase-2-unit-<n>`.
3. **Build:** Implement ONLY the scope of that unit. Do not leak functionality from future units.
4. **Test:**
   - Execute `npm test` (`node --test`). Must be green.
   - Run the real execution check against real services/files (e.g. real Companies House API call for 2.3, browser test for 2.4, extraction for 2.5, etc.).
   - If tests fail, fix them on the branch. **Never merge red.**
5. **Commit & Push:**
   - Verify `git status`: check that `.env`, credentials, or temporary files are NOT staged.
   - Commit changes with a clean, concise message: `git commit -m "Phase 2 Unit <n>: <Description>"`.
   - Push branch to remote: `git push -u origin phase-2-unit-<n>`.
6. **Pull Request Creation:**
   - Create PR using GitHub CLI: `gh pr create --fill`.
7. **Merge:**
   - Merge the PR using GitHub CLI: `gh pr merge --merge`.
8. **Clean Branches:**
   - Switch back to `main`: `git checkout main && git pull origin main`.
   - Delete local branch: `git branch -d phase-2-unit-<n>`.
   - Delete remote branch: `git push origin --delete phase-2-unit-<n>` (if not automatically deleted by `gh`).
9. **Tick the Checklist:**
   - Update `docs/checklist.md` to change status from `[ ]` to `[x]`.
   - Commit this change directly to `main`: `git add docs/checklist.md && git commit -m "docs: mark Unit <n> done in checklist" && git push origin main`.
10. **Proceed:** Only then start the next unit.

### Strict Safety Invariants
- **NEVER run destructive Git commands** (`git reset --hard`, `git checkout .`, force-pushing, `git branch -D` on an unmerged branch) without explicit user permission.
- **NEVER commit `.env` or API secrets.** Always verify `git status` before committing.
- **Minimal Comments:** 1 line max, strictly explaining *why*, never *what*.

---

## 2. Exact Unit-by-Unit Scope & Dependencies (Units 2.3 – 2.7)

### Unit 2.3 — Officers Integration
- **Objective:** Integrate official Companies House Officers API to retrieve active directors' names for candidate companies.
- **Endpoint:** `GET https://api.company-information.service.gov.uk/company/{company_number}/officers`
- **Authentication & Resilience:**
  - Reuse HTTP Basic auth (`authHeader(process.env.COMPANIES_HOUSE_API_KEY)`) from `src/companiesHouse.js`.
  - Reuse retry logic for 429 (respecting `x-ratelimit-reset`) and 5xx backoff.
- **Logic & Filtering:**
  - Query officers for a company.
  - Filter officers: keep those where `!officer.resigned_on` AND `officer.officer_role.includes('director')`.
  - Exclude secretaries, liquidators, etc.
  - Extract active director name(s) (e.g. format `"SURNAME, Forename"` to clean string).
  - Handle edge cases: 404 (no officers on file) → return `""`; 0 active directors → return `""`.
- **Files Modified / Created:**
  - `src/companiesHouse.js` (export officer retrieval function or helper)
  - `src/enrich/officers.js` (module to fetch and process active directors for candidate records)
  - `src/enrich/officers.test.js` (unit tests with mocked `fetch`)
- **Verification Command:**
  - `npm test` passes mocked tests (200 OK, multiple directors, resigned directors, 404 not found, 429 retry).
  - Real execution test: script querying a real active company number from `companies.csv` (e.g. `17454984`) returns real director name.

---

### Unit 2.4 — Web Scraping Setup
- **Objective:** Install and configure headless browser automation (Puppeteer) with stealth capabilities to bypass free search engine API limits.
- **Scope:**
  - Install `puppeteer` (and stealth plugin if needed).
  - Build reusable browser utility `src/enrich/scraper.js`.
  - Configure robust browser launch parameters for Linux/Ubuntu environment (`--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`).
  - Provide helper methods: `createBrowser()`, `closeBrowser()`, `fetchPageHtml(url)`, `searchQuery(query)`.
- **Files Modified / Created:**
  - `package.json` & `package-lock.json` (add puppeteer dependencies)
  - `src/enrich/scraper.js`
  - `src/enrich/scraper.test.js`
- **Verification Command:**
  - Unit/integration test: headless browser launches, navigates to a test query or static URL, retrieves title/HTML, and terminates cleanly without leaving orphan processes.

---

### Unit 2.5 — Search & Social Extraction
- **Objective:** Search candidate companies, classify presence vs own website, and extract social/directory links and raw contact details.
- **Scope & Algorithm:**
  1. **Search Execution:** Search DuckDuckGo/Google for `"company_name" "postcode"`.
  2. **Own Website Classification:**
     - Examine search result domains.
     - If an independent custom domain matching the business is detected (not on directory list), classify as `has_website` and STOP further processing for this company.
  3. **Social & Directory Link Extraction:**
     - Extract URLs for Facebook (`facebook.com`), Instagram (`instagram.com`), LinkedIn (`linkedin.com/company`), Google Maps (`google.com/maps`), and directories (Yell, Checkatrade, Bark, Cylex, Thomson Local, FreeIndex).
  4. **Public Page Fetching:**
     - For non-website companies, visit discovered public social/directory URLs.
     - Plain public fetch only; skip any page presenting a login wall or captcha.
  5. **Regex Contact Discovery:**
     - Extract emails using pattern `/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g`.
     - Filter out false positives (images `.png`, `.jpg`, generic platforms `sentry@`, `wixpress.com`).
     - Extract UK telephone/mobile candidates using pattern `/(?:(?:\+44\s?\(0\)\s?|\+44\s?|0))([1-9]\d{1,4}\s?\d{3,4}\s?\d{3,4})/g`.
  6. **Provenance Recording:** Store the exact URL where each email (`email_source`) and phone (`phone_source`) was retrieved.
- **Files Modified / Created:**
  - `src/enrich/search.js`
  - `src/enrich/extract.js`
  - `src/enrich/search.test.js`
  - `src/enrich/extract.test.js`
- **Verification Command:**
  - Unit tests covering regex extraction, email cleansing, and directory domain matching.
  - Real run against 5 candidate companies verifying link discovery and contact extraction.

---

### Unit 2.6 — leads.csv & Normalisation
- **Objective:** Normalise discovered phone numbers, apply WhatsApp and lead qualification rules, append qualified leads to `leads.csv`, and update `enriched.csv`.
- **Scope & Logic:**
  1. **Phone Normalisation:**
     - Convert UK numbers to international standard `+44...`.
     - Remove spaces, hyphens, and brackets.
     - Identify UK mobiles: starts with `+447` (`07...`).
  2. **Flag Assignment:**
     - `whatsapp_candidate`: `'yes'` ONLY if phone is a UK mobile (`+447...`). Landlines (`+441`, `+442`, `+443`) are marked `'no'`.
     - `whatsapp_mentioned`: `'yes'` if the keyword "whatsapp" was present in the source snippet or context, else `'no'`.
  3. **Status & Priority:**
     - `status`:
       - `'lead'`: No website AND (valid `email` OR valid mobile `phone`).
       - `'has_website'`: Own website discovered.
       - `'nothing_found'`: Neither website nor qualifying contact found.
     - `priority`:
       - `'email+mobile'`: Both email and mobile present.
       - `'email'`: Email present, no mobile.
       - `'mobile'`: Mobile present, no email.
       - `''`: For non-leads.
  4. **Persistence:**
     - Format and append records to `leads.csv` (20 standard columns, RFC 4180 quoting, newlines replaced with spaces).
     - Append company to `enriched.csv` (`company_number,checked_at,status`) to prevent re-processing.
- **Files Modified / Created:**
  - `src/enrich/phone.js`
  - `src/enrich/leads.js`
  - `src/enrich/phone.test.js`
  - `src/enrich/leads.test.js`
- **Verification Command:**
  - Unit tests for phone normalisation (`07`, `+447`, landlines, invalid formats).
  - Unit tests for priority assignment and lead filtering.
  - CSV write/append tests verifying header formatting and quoting.

---

### Unit 2.7 — End-to-End Enrichment Pipeline
- **Objective:** Connect the complete enrichment pipeline into a runnable CLI script (`npm run enrich`).
- **Scope:**
  - Orchestrate pipeline:
    1. Read `companies.csv`.
    2. Filter candidates via Unit 2.2 (`filter.js`) against `enriched.csv`, age (7–60 days), and target SIC codes → `candidates.csv`.
    3. Query Companies House Officers API for each candidate (Unit 2.3).
    4. Run scraper search and page extraction (Units 2.4 & 2.5).
    5. Normalise contacts and generate outputs (Unit 2.6) → `leads.csv` and `enriched.csv`.
  - Add `"enrich": "node src/enrich/index.js"` script to `package.json`.
  - Add progress logging (companies processed, leads found, websites dropped, yield rate).
  - Update `README.md` with usage documentation.
- **Files Modified / Created:**
  - `src/enrich/index.js`
  - `package.json`
  - `README.md`
- **Verification Command:**
  - Execute `npm run enrich` on project data.
  - Verify `leads.csv` rows, `enriched.csv` entries, and terminal summary metrics.

---

## 3. Acceptance Criteria for Phase 2 Completion

To deem Phase 2 complete, the implementation must satisfy all of the following criteria:

### Workflow & Repository Criteria
- [ ] Individual dedicated branches created for Units 2.3, 2.4, 2.5, 2.6, 2.7 (`phase-2-unit-3` to `phase-2-unit-7`).
- [ ] PR created for each unit via `gh pr create --fill`.
- [ ] PR merged into `main` via `gh pr merge --merge`.
- [ ] Local and remote branches deleted after merge.
- [ ] `docs/checklist.md` updated and ticked `[x]` for each completed unit.
- [ ] No API keys, credentials, or `.env` files committed.
- [ ] Code follows style rules: plain beginner-friendly functions, minimal 1-line comments explaining *why*.

### Testing & Quality Criteria
- [ ] `npm test` (`node --test`) passes with 0 failures on all units.
- [ ] CI workflow (`.github/workflows/ci.yml`) passes cleanly on GitHub for all merged PRs.
- [ ] Real execution test executed and verified for each unit prior to merging.

### Functional Pipeline Criteria
- [ ] `npm run enrich` runs end-to-end without unhandled promise rejections or fatal crashes.
- [ ] Companies with an existing website are dropped (`status = 'has_website'`).
- [ ] All records in `leads.csv` have `status = 'lead'` and possess at least an email or mobile number.
- [ ] Only UK `07` mobile numbers have `whatsapp_candidate = 'yes'`.
- [ ] Every email and phone number includes exact provenance in `email_source` and `phone_source`.
- [ ] `enriched.csv` records all processed company numbers, preventing re-checking in future runs.

---

## 4. Data Schemas, Fields, and Formats

### 1. `candidates.csv` (Output of 2.2 / Input to 2.3)
Generated by `src/enrich/filter.js`:
| Column Name | Type | Description / Format | Example |
|-------------|------|----------------------|---------|
| `company_number` | String | 8-character UK company number | `17454984` |
| `company_name` | String | Official registered company name | `SOUTHEND HOME ESSENTIALS LIMITED` |
| `date_of_creation` | String | ISO creation date `YYYY-MM-DD` | `2026-09-12` |
| `company_status` | String | Status on register | `active` |
| `company_type` | String | Company classification | `ltd` |
| `sic_codes` | String | Semicolon-delimited 5-digit SIC codes | `47190;45200` |
| `registered_office_address` | String | Flattened registered office address | `163 High Street, Southend-On-Sea, SS1 1LL, England` |
| `agent_address` | String | Flag if address matches formation agent (`>= 20` co.) | `yes` or `no` |

*Unit 2.3 adds or produces records carrying `director_name` (active director) into the enrichment flow.*

---

### 2. `leads.csv` (Final Phase 2 Output)
Exactly 20 columns specified in `docs/path.md` (lines 139–145):

| # | Column Name | Type | Allowed Values / Format | Description |
|---|-------------|------|-------------------------|-------------|
| 1 | `company_number` | String | 8 alphanumeric | Companies House company number |
| 2 | `company_name` | String | Text | Official company name |
| 3 | `date_of_creation` | String | `YYYY-MM-DD` | Incorporation date |
| 4 | `sic_codes` | String | Semicolon-delimited strings | 5-digit SIC codes |
| 5 | `registered_office_address` | String | Comma-delimited text | Flattened address |
| 6 | `director_name` | String | Text | Active director name (from Unit 2.3) |
| 7 | `email` | String | Valid email address or empty | Scraped contact email |
| 8 | `email_source` | String | URL or empty | Exact page URL where email was found |
| 9 | `phone` | String | E.164 (`+44...`) or empty | Normalised telephone/mobile number |
| 10 | `phone_source` | String | URL or empty | Exact page URL where phone was found |
| 11 | `whatsapp_candidate` | String | `'yes'` / `'no'` | `'yes'` ONLY for UK `07` mobiles |
| 12 | `whatsapp_mentioned` | String | `'yes'` / `'no'` | `'yes'` if "WhatsApp" appeared in context |
| 13 | `priority` | String | `'email+mobile'`, `'email'`, `'mobile'`, `''` | Lead contact prioritization |
| 14 | `facebook` | String | URL or empty | Facebook page URL |
| 15 | `instagram` | String | URL or empty | Instagram profile URL |
| 16 | `linkedin` | String | URL or empty | LinkedIn company profile URL |
| 17 | `google_maps` | String | URL or empty | Google Maps / Places listing URL |
| 18 | `other_links` | String | Semicolon-delimited URLs | Directory listings (Yell, Bark, etc.) |
| 19 | `status` | String | `'lead'`, `'has_website'`, `'nothing_found'` | Qualification status |
| 20 | `collected_at` | String | ISO 8601 Timestamp | Processing date/time (`YYYY-MM-DDTHH:mm:ssZ`) |

---

### 3. `enriched.csv` (Memory / Deduplication Cache)
Used to skip companies across runs:
| Column Name | Type | Description |
|-------------|------|-------------|
| `company_number` | String | 8-character company number |
| `checked_at` | String | Date or ISO timestamp when checked |
| `status` | String | Final outcome: `lead`, `has_website`, or `nothing_found` |

*Note: In `src/enrich/filter.js`, existing implementation checks membership via `new Set(enriched.map(r => r.company_number))`.*

---

## 5. Hard Constraints & Compliance Directives

### 1. Prohibition on Login & Account Automation
- **Zero Credentials:** The scraper must NEVER log in to Facebook, Instagram, LinkedIn, or any platform.
- **Login Walls:** When encountering a login wall, authentication prompt, or aggressive anti-bot screen, **immediately skip the page**. Never retry with credentials or attempt automated bypasses.

### 2. Website vs Directory Distinction
Nahid's business model is selling website development. A company that already possesses a dedicated website is disqualified.
- **"Has a Website":** Strictly defined as an **independent custom domain** owned by the business (e.g. `www.acmebakers.co.uk`, `joestrading.com`).
- **"Directory / Platform Presence" (NOT a website):** Listings on third-party portals do NOT count as a website. Companies with directory entries remain valid lead candidates.
- **Directory Domains List (Non-Exhaustive Core):**
  - `yell.com`
  - `checkatrade.com`
  - `bark.com`
  - `freeindex.co.uk`
  - `cylex-uk.co.uk`
  - `thomsonlocal.com`
  - `restaurantguru.com`
  - `wanderlog.com`
  - `zmenu.com`
  - `menucollector.com`
  - `yelp.com` / `yelp.co.uk`
  - `tripadvisor.com` / `tripadvisor.co.uk`
  - `ubereats.com`
  - `just-eat.co.uk`
  - `deliveroo.co.uk`
  - `trustpilot.com`
  - `*.wheree.com`
  - `*.placejoys.com`
  - Social media platforms: `facebook.com`, `instagram.com`, `linkedin.com`, `twitter.com`, `x.com`
  - Public company registers: `find-and-update.company-information.service.gov.uk`, `companiesintheuk.co.uk`, `endole.co.uk`, `duedil.com`, `companycheck.co.uk`

### 3. UK Telephone & Mobile Rules
- **Normalisation:** All UK numbers must be formatted to E.164 (`+44...`).
- **WhatsApp Candidate Rules:**
  - Only UK mobile numbers (`07...`, formatted as `+447...`) can be flagged `whatsapp_candidate = 'yes'`.
  - Landlines (`01...`, `02...`, `03...`) must be flagged `whatsapp_candidate = 'no'`.
  - WhatsApp numbers are **never verified** (no free/legal verification API exists).
  - If the term "WhatsApp" is located adjacent to the phone number on the scraped page, record `whatsapp_mentioned = 'yes'`.

### 4. UK GDPR / PECR Compliance
- An individual director's personal mobile number or direct email constitutes personal data under UK GDPR and PECR.
- To maintain legal defensibility and satisfy ICO audit requirements ("Where did you get this contact?"), **every row in `leads.csv` must record the exact URL in `email_source` and `phone_source`**.

### 5. Email Integrity
- **No Email Guessing:** Never synthesize or guess email addresses (e.g., `info@companyname.co.uk` or `first.last@gmail.com`). An empty field is strictly preferred over an unverified or synthesized address.

### 6. Scope Boundaries
- **No AI Research / No LLM API calls in production pipeline.**
- **No Lead Scoring.**
- **No Messaging Automation:** Do not send emails, SMS, or WhatsApp messages.
- **Cost:** All tools and scraping strategies must operate within 100% free mechanisms.

---

## 6. Implementation Order & Critical Path Summary

```
[Phase 1] companies.csv (Completed)
    │
    ▼
[Unit 2.2] filter.js (Completed) -> candidates.csv
    │
    ▼
[Unit 2.3] officers.js (Branch: phase-2-unit-3)
    │     - GET /company/{number}/officers
    │     - Extracts active director name
    ▼
[Unit 2.4] scraper.js (Branch: phase-2-unit-4)
    │     - Puppeteer + stealth setup
    │     - Headless navigation utility
    ▼
[Unit 2.5] search.js & extract.js (Branch: phase-2-unit-5)
    │     - Search company + postcode
    │     - Drop if own website found
    │     - Extract social/directory URLs & scrape email/mobile
    ▼
[Unit 2.6] phone.js & leads.js (Branch: phase-2-unit-6)
    │     - Normalise +44 phone numbers
    │     - Classify WhatsApp candidate (07 only)
    │     - Generate leads.csv & enriched.csv
    ▼
[Unit 2.7] index.js (Branch: phase-2-unit-7)
          - End-to-end npm run enrich script
          - Yield measurement & docs update
```

Every unit must strictly execute the full Git workflow (branch → build → unit test + real test → commit/push → `gh pr create --fill` → `gh pr merge --merge` → delete branch → tick `docs/checklist.md`).
