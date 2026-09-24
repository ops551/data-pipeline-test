# Execution Plan — Phase 2 Contact Discovery

## Objective
Deliver Phase 2 Units (2.3 through 2.7) strictly following `docs/working-style.md` and `docs/checklist.md`, adhering to the git branch -> test -> PR (`gh pr create --fill`) -> merge (`gh pr merge --merge`) -> delete branch -> tick checklist workflow for each unit.

## Milestones & Units

### Milestone 0: Survey & Scope Specification
- Survey codebase (Phase 1 structure, existing `companiesHouse.js`, `enrich/filter.js`, test setup)
- Survey requirements from `docs/path.md`, `docs/checklist.md`, `GEMINI.md`, `CLAUDE.md`, and official API docs
- Synthesize findings into `PROJECT.md` at root

### Milestone 1: Unit 2.3 — Officers API Integration
- Branch: `phase-2-unit-3`
- Endpoint: `GET /company/{number}/officers` (free Companies House API)
- Extract active directors' names into candidate flow
- Files: `src/companiesHouse.js`, `src/enrich/officers.js`, unit tests
- Verification: Unit tests with mocked fetch + live API verification against `.env` key
- PR, merge, delete branch, tick `docs/checklist.md`

### Milestone 2: Unit 2.4 — Scraping Setup (Puppeteer)
- Branch: `phase-2-unit-4`
- Install Puppeteer / stealth plugins
- Headless browser utility module to search DuckDuckGo / Google
- Files: `package.json`, `src/enrich/scraper.js`, tests
- Verification: Headless browser runs test query, returns HTML/links
- PR, merge, delete branch, tick `docs/checklist.md`

### Milestone 3: Unit 2.5 — Search & Social Extraction
- Branch: `phase-2-unit-5`
- Search `company name postcode`
- If company has own website -> mark `has_website`, skip
- Otherwise grab social media URLs (Facebook, Instagram, LinkedIn, directory listings)
- Visit extracted URLs via scraper to extract emails and UK mobile numbers via regex
- Files: `src/enrich/search.js`, `src/enrich/extract.js`, tests
- PR, merge, delete branch, tick `docs/checklist.md`

### Milestone 4: Unit 2.6 — leads.csv & Phone Normalisation
- Branch: `phase-2-unit-6`
- Phone normalisation to `+44...`
- `whatsapp_candidate = yes` only for `07` mobiles
- Status rules: `lead` requires email or mobile; record sources & timestamps
- Tracking in `enriched.csv` to avoid re-checking
- Files: `src/enrich/leads.js`, `src/enrich/phone.js`, tests
- PR, merge, delete branch, tick `docs/checklist.md`

### Milestone 5: Unit 2.7 — End-to-End Pipeline & Yield Verification
- Branch: `phase-2-unit-7`
- `npm run enrich` wires full pipeline (2.2 -> 2.6)
- Files: `src/enrich/index.js`, `package.json`, `README.md`
- Verification: Running pipeline on candidate list generates `leads.csv` with valid leads
- PR, merge, delete branch, tick `docs/checklist.md`

### Milestone 6: Final Verification & Audit
- Verification against all criteria in `ORIGINAL_REQUEST.md`
- Final report to Sentinel / User
