# Codebase Survey & Architecture Investigation Report

**Date:** 2026-09-24  
**Investigator:** teamwork_preview_explorer_survey_2  
**Repository:** Nahid625/Recent-uk-Companys  
**Working Directory:** `/home/nahid/Documents/Recent-uk-Companys`  

---

## 1. Executive Summary

This investigation analyzed the repository structure, git state, system environment, dependencies, testing conventions, and source code of the **Recent UK Companies** lead generation system.

- **Phase 1 (Companies House Collector)** is complete, thoroughly tested, and merged into `main`. It reliably queries the Companies House Advanced Search API, extracts recently incorporated UK companies, performs pagination and duplicate suppression, and outputs to `companies.csv`.
- **Phase 2 (Contact Discovery)** has completed Units 2.0 (Hit-Rate Test), 2.1 (Scope Update / Documentation / CI), and 2.2 (Candidate Filter in `src/enrich/`).
- **Units 2.3 to 2.7** remain to be implemented sequentially following the strict git PR workflow documented in `docs/working-style.md` and tracked in `docs/checklist.md`.
- **Tooling & Environment** are verified and healthy: Node.js v24.18.0, npm 11.16.0, git 2.43.0, gh CLI 2.98.0 authenticated as `Nahid625` with full repo access. Google Chrome 153.0.8010.47 is pre-installed at `/usr/bin/google-chrome-stable`.

---

## 2. System Environment & Tooling Verification

| Tool / Component | Version / Path | Status / Notes |
|---|---|---|
| **Node.js** | `v24.18.0` | Compatible with `package.json` engine constraint (`>=18`). |
| **npm** | `11.16.0` | Working properly. |
| **Git** | `2.43.0` | Working properly. |
| **GitHub CLI (`gh`)** | `2.98.0` | Authenticated as `Nahid625` (keyring). Protocol: https. Scopes: `gist`, `read:org`, `repo`, `workflow`. |
| **Browser Binaries** | `/usr/bin/google-chrome-stable` (153.0.8010.47) | System Google Chrome is available. Puppeteer can utilize this binary or download bundled Chromium. |
| **CI Workflow** | `.github/workflows/ci.yml` | GitHub Actions workflow runs on `ubuntu-latest` with Node `20.x`, executes `npm ci` and `npm test` on PR and push to `main`. |

---

## 3. Git Repository Status & Workflow

### 3.1 Status & Remotes
- **Current Branch:** `main` (HEAD is at `9b1838b`, clean working tree, identical to `origin/main`).
- **Remote Origin:** `https://github.com/Nahid625/Recent-uk-Companys.git` (both fetch and push).
- **Untracked files:** Only `.agents/` directory (agent teamwork metadata).

### 3.2 Commit & PR History
Recent Pull Requests on GitHub:
- **PR #1:** `phase-2-unit-1` (Merged at commit `b095fe5`) — Updated scope for Puppeteer scraping, updated docs (`CLAUDE.md`, `GEMINI.md`, `docs/checklist.md`, `docs/path.md`), added CI workflow (`.github/workflows/ci.yml`).
- **PR #2:** `fix-readme` (Merged at commit `969ab95`) — Cleaned up Development Workflow section from `README.md`.
- **PR #3:** `phase-2-unit-2` (Merged at commit `9b1838b`) — Candidate filter implementation (`src/enrich/csvParser.js`, `src/enrich/sic.js`, `src/enrich/filter.js`, `src/enrich/filter.test.js`).

### 3.3 Git PR Workflow Requirements (`docs/working-style.md`)
For each unit:
1. Plan in `docs/checklist.md`.
2. Create dedicated branch `phase-<n>-unit-<n>` from up-to-date `main`.
3. Build only that unit.
4. Test with `npm test` (and live test where applicable).
5. Commit and push branch to `origin`.
6. Create PR via `gh pr create --fill`.
7. Merge PR via `gh pr merge --merge`.
8. Delete branch both locally and remotely (`git branch -d ...` and `git push origin --delete ...`).
9. Update `docs/checklist.md` on `main` and push.

---

## 4. Project Configuration & Secrets Management

### 4.1 `package.json`
- **Name:** `recent-uk-companies`, version `1.0.0`, `"private": true`.
- **Main:** `src/index.js`.
- **Scripts:**
  - `"start": "node src/index.js"`
  - `"test": "node --test"`
  - *(Note: `"enrich"` script is planned for Unit 2.7)*
- **Dependencies:**
  - `"dotenv": "^18.0.1"` (only dependency currently installed).
  - Puppeteer is not yet installed (scheduled for Unit 2.4).

### 4.2 `.gitignore`
Current contents:
```
.env
companies.csv
node_modules/
```
*Note for Phase 2:* Files generated in Phase 2 (`candidates.csv`, `enriched.csv`, `leads.csv`) and potential scraper artifacts/caches will need to be checked and added to `.gitignore` when appropriate.

### 4.3 `.env` and `.env.example`
- `.env.example` provides documentation for:
  - `COMPANIES_HOUSE_API_KEY=your_key_here`
  - `DAYS_BACK=7` (or `INCORPORATED_FROM` / `INCORPORATED_TO`)
  - `MAX_RESULTS=1000`
- `.env` is present in root, ignored by git (`git check-ignore` confirms).
- Key verification: Verified `.env` defines `COMPANIES_HOUSE_API_KEY` without exposing its secret value.

---

## 5. Phase 1 Architecture (`src/`)

Phase 1 provides the foundation for company discovery and data fetching:

| File | Purpose & Responsibilities | Key Functions / Exports |
|---|---|---|
| `src/config.js` | Loads `.env` via `dotenv`. Validates `COMPANIES_HOUSE_API_KEY`. Parses date ranges (`INCORPORATED_FROM`/`TO` or `DAYS_BACK`). Validates integer limits. | `loadConfig(env, today)` |
| `src/companiesHouse.js` | Low-level client for Companies House API (`GET /advanced-search/companies`). Encodes HTTP Basic auth (`Basic base64("<apiKey>:")`). Handles HTTP 401 (throws), HTTP 429 (waits until `x-ratelimit-reset` header timestamp), HTTP 5xx & network errors (exponential backoff up to 5 retries). | `searchCompanies(params, deps)`, `buildUrl(params)` |
| `src/collect.js` | Pagination loop using `size=500` and `start_index`. Tracks seen companies via `Set`. Halts when `maxResults` is reached, hits are exhausted, or an empty page is returned. | `collectCompanies(config, deps)` |
| `src/csv.js` | Custom CSV serializer and deserializer. Flattens `registered_office_address` parts into a single string. Escapes quotes and commas. Reads existing `company_number`s from `companies.csv` to avoid re-fetching previously captured companies. | `COLUMNS`, `toRow`, `toLine`, `readCompanyNumbers`, `appendCompanies` |
| `src/index.js` | CLI entry point. Coordinates `loadConfig` → `readCompanyNumbers` → `collectCompanies` → `appendCompanies`. | `main()` |

---

## 6. Phase 2 Architecture & Current State (`src/enrich/`)

Phase 2 focuses on filtering candidate companies and discovering contact channels (email and WhatsApp-capable mobile) for companies without existing websites.

### 6.1 Implemented Modules (Units 2.1 & 2.2)
- **`src/enrich/csvParser.js`**:
  - `parseCSV(filePath)`: Reads CSV and parses rows into objects keyed by header names, handling quoted cells with escaped quotes (`""`).
  - `writeCSV(filePath, data, columns)`: Serializes array of objects to CSV with headers and proper quote escaping.
- **`src/enrich/sic.js`**:
  - `TARGET_SICS`: List of physical/active trade SIC codes (retail, food, hospitality, cleaning, tutoring, fitness, personal services, photography, trades).
  - `EXCLUDED_SICS`: List of holding, SPV, trusts, real estate SPV, dormant (`99999`), and non-trading codes.
  - `isTargetSic(sicString)`: Immediate rejection if any excluded SIC is present; accepts if at least one target SIC matches.
- **`src/enrich/filter.js`**:
  - `getDaysOld(creationDateStr)`: Calculates age in days from current date.
  - `filterCandidates(companiesFile, enrichedFile, candidatesFile)`:
    - Filters `companies.csv` to keep companies between 7 and 60 days old.
    - Excludes companies already listed in `enriched.csv`.
    - Filters by `isTargetSic`.
    - Detects formation agent addresses (flags `agent_address = 'yes'` if address frequency >= 20).
    - Writes results to `candidates.csv`.
- **`src/enrich/filter.test.js`**: Unit tests verifying SIC logic, date math, and file filtering.

### 6.2 Remaining Phase 2 Units (Units 2.3 – 2.7)

| Unit | Title | Target Files | Scope / Requirements |
|---|---|---|---|
| **2.3** | **Officers** | `src/companiesHouse.js`, `src/enrich/officers.js` | Call `GET /company/{number}/officers` (free Companies House endpoint). Extract active directors' names into candidates. Reuse existing HTTP Basic auth. |
| **2.4** | **Scraping Setup** | `package.json`, `src/enrich/scraper.js` | Install `puppeteer` (or `playwright`). Create headless browser manager capable of querying search engines (DuckDuckGo / Google) stealthily. |
| **2.5** | **Search & Social Extraction** | `src/enrich/search.js`, `src/enrich/extract.js` | Search `company name + postcode`. If own website found -> flag `has_website` and stop. Otherwise extract Facebook, Instagram, LinkedIn, directory links. Visit extracted URLs to extract emails and mobile numbers via Regex. |
| **2.6** | **`leads.csv`** | `src/enrich/leads.js`, `src/enrich/phone.js` | Normalise phone numbers to `+44...`. Flag `whatsapp_candidate = yes` only for `07` UK mobiles. Set `status = lead` if email or mobile is present. Append to `leads.csv` with provenance sources (`email_source`, `phone_source`). Record checked numbers in `enriched.csv`. |
| **2.7** | **End-to-End Pipeline** | `src/enrich/index.js`, `package.json`, `README.md` | Add `"enrich": "node src/enrich/index.js"` script to `package.json`. Wire Units 2.2 through 2.6. Measure lead yield. Update documentation. |

---

## 7. Testing Architecture & Style Analysis

The codebase adheres to a clear, minimalist testing philosophy:

1. **Zero External Test Frameworks:**
   - Runs exclusively via Node.js built-in test runner (`node --test`), invoked by `npm test`.
   - Uses built-in `node:assert` and `node:assert/strict`.
2. **Co-located Test Files:**
   - Tests reside directly alongside implementation files (`src/collect.test.js`, `src/companiesHouse.test.js`, `src/config.test.js`, `src/csv.test.js`, `src/enrich/filter.test.js`).
   - There is NO separate top-level `test/` directory.
3. **Dependency Injection for Mocking:**
   - Instead of mocking libraries (e.g. Sinon, Jest, Nock), modules accept dependency injection parameters with production defaults:
     ```js
     // Example from src/companiesHouse.js
     async function searchCompanies(params, deps = {}) {
       const { fetchFn = fetch, sleepFn = sleep, log = console.log, nowFn = Date.now } = deps;
       ...
     }
     ```
   - Tests construct lightweight mock runners (`fakeResponse`, `fetchSequence`, `fakeSearch`) to simulate HTTP status codes (200, 401, 429, 500, 503) and network failures without external libraries.
4. **Current Test Status:**
   - All **32 tests pass** consistently (0 failures, runtime ~150ms).

---

## 8. Key Technical Observations & Recommendations for Phase 2 Implementation

1. **Companies House Officers API Integration (Unit 2.3):**
   - The Companies House Officers endpoint is `GET https://api.company-information.service.gov.uk/company/{company_number}/officers`.
   - It uses the exact same Basic authentication (`apiKey:` in base64) and rate limits (600 requests / 5 min) as the company search endpoint.
   - The dependency injection pattern from `src/companiesHouse.js` should be mirrored for officer retrieval.
2. **Puppeteer & Chromium Compatibility (Unit 2.4):**
   - Node 24 is installed.
   - System Chrome is located at `/usr/bin/google-chrome-stable` (v153).
   - In CI (`.github/workflows/ci.yml`), tests run on Ubuntu-latest. When adding Puppeteer, ensure puppeteer dependencies and headless launch flags (`--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`) are properly configured so that CI tests pass without display servers.
3. **CSV Parsing Strategy:**
   - Phase 1 used `src/csv.js` with streaming/line-by-line append for `companies.csv`.
   - Phase 2 introduced `src/enrich/csvParser.js` for in-memory object parsing and writing.
   - Ensure `leads.csv` and `enriched.csv` follow consistent quoting and newline-handling rules.
4. **Git Branch & PR Protocol:**
   - Strict adherence to `docs/working-style.md` is paramount: Gemini creates branch `phase-2-unit-<n>`, commits, pushes, creates PR via `gh pr create --fill`, merges via `gh pr merge --merge`, cleans branches, and ticks `docs/checklist.md`.
