# Project: Recent UK Companies — Phase 2 Contact Discovery

## Architecture
The Phase 2 Contact Discovery pipeline processes recently incorporated UK companies that have **no website** to identify their contact information (priority: email first, WhatsApp-capable UK mobile second) and outputs them to `leads.csv`.

Data Flow:
```
companies.csv (1000 recently incorporated UK companies from Phase 1)
  │
  ▼ [Unit 2.2 — already completed]
src/enrich/filter.js (filter: 7-60 days age window, target SIC codes, drop SPV/dormant, flag formation-agents)
  │
  ▼ candidates.csv
src/enrich/officers.js [Unit 2.3] (Companies House API GET /company/{number}/officers -> extract active directors)
  │
  ▼ candidates with director names
src/enrich/scraper.js [Unit 2.4] (Headless Puppeteer browser with stealth & resource optimization)
  │
  ▼
src/enrich/search.js [Unit 2.5] (Search DuckDuckGo HTML for company name + postcode)
  ├── Own website found? ──► status: has_website (dropped as lead)
  └── No own website ──► extract social media URLs (Facebook, Instagram, LinkedIn) & directory URLs
        │
        ▼
src/enrich/extract.js [Unit 2.5] (Visit social/directory pages using scraper; extract emails & phone numbers via regex)
        │
        ▼
src/enrich/phone.js & src/enrich/leads.js [Unit 2.6]
  ├── Normalise UK phones to E.164 (+44...)
  ├── Identify WhatsApp candidates (071-079 UK mobiles only; landlines = no; whatsapp_mentioned flag)
  ├── Filter false positive emails (strip assets @2x, npm packages, webmaster traps)
  ├── Output formatted rows to leads.csv (20 columns)
  └── Record processed companies in enriched.csv (dedupe memory)
        │
        ▼
src/enrich/index.js [Unit 2.7] (CLI entry point: npm run enrich)
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Companies House Officers Query | `getCompanyOfficers(companyNumber, deps)` in `src/companiesHouse.js` calling `GET /company/{number}/officers` with Basic auth, retry handling on 429/5xx | M1 (Unit 2.3) | docs/checklist.md Unit 2.3 |
| 2 | Active Director Name Extraction | `extractActiveDirectors(officersList)` in `src/enrich/officers.js` returning comma-separated active director names, ignoring resigned officers | M1 (Unit 2.3) | docs/checklist.md Unit 2.3 |
| 3 | Officers Integration & CLI Test | Unit test with mocked fetch and live test verifying live officers retrieval | M1 (Unit 2.3) | docs/checklist.md Unit 2.3 |
| 4 | Puppeteer & Stealth Setup | Install `puppeteer` (or `puppeteer-core`/`puppeteer-extra`), configure headless Linux launch flags (`--headless=new`, `--no-sandbox`, `--disable-dev-shm-usage`), block fonts/images | M2 (Unit 2.4) | docs/checklist.md Unit 2.4 |
| 5 | Scraper Utility Module | `createScraper(options)` in `src/enrich/scraper.js` providing page navigation, HTML retrieval, and safe browser lifecycle management | M2 (Unit 2.4) | docs/checklist.md Unit 2.4 |
| 6 | DuckDuckGo Search Execution | `searchCompany(name, postcode, scraper)` in `src/enrich/search.js` querying DuckDuckGo HTML endpoint and decoding `uddg` redirect URLs | M3 (Unit 2.5) | docs/checklist.md Unit 2.5 |
| 7 | Domain Classification & Own Website Detection | `classifyDomain(url)` distinguishing own websites from Companies House mirrors, search engines, social platforms, and directories | M3 (Unit 2.5) | docs/path.md lines 121-126 |
| 8 | Social & Directory URL Extraction | Extract public Facebook, Instagram, LinkedIn, and UK directory URLs from search results | M3 (Unit 2.5) | docs/checklist.md Unit 2.5 |
| 9 | Public Page Contact Scraping | `extractContactsFromUrl(url, scraper)` in `src/enrich/extract.js` visiting public pages without login and extracting emails & phones | M3 (Unit 2.5) | docs/checklist.md Unit 2.5 |
| 10 | UK Phone Normalisation | `normaliseUkPhone(rawPhone)` in `src/enrich/phone.js` converting UK numbers to `+44...`, handling `(0)` domestic notation | M4 (Unit 2.6) | docs/checklist.md Unit 2.6 |
| 11 | WhatsApp Candidate Identification | `isWhatsAppCandidate(normalisedPhone)` identifying `071`-`079` mobiles as `yes`, landlines as `no`, setting `whatsapp_mentioned` | M4 (Unit 2.6) | docs/path.md lines 128-130 |
| 12 | Email Cleaning & False Positive Rejection | Filter extracted emails against asset filenames (`@2x.png`), version strings, and platform spam traps | M4 (Unit 2.6) | docs/path.md line 127 |
| 13 | leads.csv Schema & Append | `appendLeads(leads)` in `src/enrich/leads.js` writing 20 specified columns, properly escaped and quoted | M4 (Unit 2.6) | docs/path.md lines 139-145 |
| 14 | enriched.csv Memory Tracking | Record processed company numbers in `enriched.csv` with status and timestamp to prevent redundant processing | M4 (Unit 2.6) | docs/path.md lines 134-136 |
| 15 | End-to-End Enrichment Pipeline | `src/enrich/index.js` wiring filter -> officers -> scraper -> search -> extract -> leads -> enriched | M5 (Unit 2.7) | docs/checklist.md Unit 2.7 |
| 16 | npm run enrich Script & Docs | Add `"enrich": "node src/enrich/index.js"` to `package.json`, update `README.md` with usage instructions | M5 (Unit 2.7) | docs/checklist.md Unit 2.7 |
| 17 | Final Acceptance & Yield Verification | Run real pipeline against candidate companies, measure yield, verify `leads.csv` validity, update `docs/checklist.md` | M5 (Unit 2.7) | ORIGINAL_REQUEST.md AC |

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Unit 2.3: Officers API | `src/companiesHouse.js`, `src/enrich/officers.js`, tests, PR #4 | Unit 2.2 (merged) | DONE |
| M2 | Unit 2.4: Scraping Setup | `package.json`, `src/enrich/scraper.js`, tests, PR #5 | M1 | IN_PROGRESS |
| M3 | Unit 2.5: Search & Extraction | `src/enrich/search.js`, `src/enrich/extract.js`, `src/enrich/domainClassifier.js`, tests, PR #6 | M2 | PLANNED |
| M4 | Unit 2.6: leads.csv & Phone | `src/enrich/phone.js`, `src/enrich/leads.js`, tests, PR #7 | M3 | PLANNED |
| M5 | Unit 2.7: End-to-End Pipeline | `src/enrich/index.js`, `package.json`, `README.md`, PR #8, checklist update | M4 | PLANNED |

## Interface Contracts

### M1 (Officers): `src/companiesHouse.js` ↔ `src/enrich/officers.js`
- `getCompanyOfficers(companyNumber, deps)` -> `Promise<{ items: Array<Officer>, total_results: number, active_count: number }>`
- `extractActiveDirectors(officersList)` -> `string` (e.g. `"SMITH, John, DOE, Jane"` or `""` if none)
- Officer filtering rule: `!officer.resigned_on && officer.officer_role && officer.officer_role.toLowerCase().includes('director')`

### M2 (Scraper): `src/enrich/scraper.js`
- `createScraper(options)` -> `Promise<ScraperInstance>`
- `ScraperInstance.fetchHtml(url, options)` -> `Promise<{ html: string, finalUrl: string, statusCode: number }>`
- `ScraperInstance.close()` -> `Promise<void>`
- Launch flags: `--headless=new`, `--no-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`

### M3 (Search & Extraction): `src/enrich/search.js` & `src/enrich/extract.js`
- `searchCompany(name, postcode, scraper)` -> `Promise<{ hasWebsite: boolean, websiteUrl?: string, socialUrls: { facebook?: string, instagram?: string, linkedin?: string }, directoryUrls: string[] }>`
- `extractContactsFromUrl(url, scraper)` -> `Promise<{ emails: string[], phones: string[] }>`

### M4 (Leads & Phone): `src/enrich/phone.js` & `src/enrich/leads.js`
- `normaliseUkPhone(rawPhone)` -> `{ raw: string, normalised: string | null, type: 'mobile' | 'landline' | 'other' | 'invalid', isWhatsAppCandidate: boolean }`
- `leads.csv` Schema (20 columns in exact order):
  1. `company_number`
  2. `company_name`
  3. `date_of_creation`
  4. `sic_codes`
  5. `registered_office_address`
  6. `director_name`
  7. `email`
  8. `email_source`
  9. `phone`
  10. `phone_source`
  11. `whatsapp_candidate` ("yes" | "no")
  12. `whatsapp_mentioned` ("yes" | "no")
  13. `priority` ("email+mobile" | "email" | "mobile" | "none")
  14. `facebook`
  15. `instagram`
  16. `linkedin`
  17. `google_maps`
  18. `other_links`
  19. `status` ("lead" | "has_website" | "nothing_found")
  20. `collected_at` (ISO timestamp)

### M5 (Pipeline): `src/enrich/index.js`
- Invocation: `npm run enrich`
- Input: reads `companies.csv` (or generates via Phase 1 collector if missing)
- Filters via `filterCompanies` -> creates `candidates.csv`
- Processes candidates sequentially, writing leads to `leads.csv` and deduplication state to `enriched.csv`

## Code Layout
```
Recent-uk-Companys/
├── .github/workflows/ci.yml
├── docs/
│   ├── checklist.md
│   ├── path.md
│   └── working-style.md
├── src/
│   ├── collect.js
│   ├── collect.test.js
│   ├── companiesHouse.js
│   ├── companiesHouse.test.js
│   ├── config.js
│   ├── config.test.js
│   ├── csv.js
│   ├── csv.test.js
│   ├── index.js
│   └── enrich/
│       ├── csvParser.js
│       ├── filter.js
│       ├── filter.test.js
│       ├── sic.js
│       ├── officers.js          # Unit 2.3
│       ├── officers.test.js     # Unit 2.3
│       ├── scraper.js           # Unit 2.4
│       ├── scraper.test.js      # Unit 2.4
│       ├── domainClassifier.js  # Unit 2.5
│       ├── search.js            # Unit 2.5
│       ├── search.test.js       # Unit 2.5
│       ├── extract.js           # Unit 2.5
│       ├── extract.test.js      # Unit 2.5
│       ├── phone.js             # Unit 2.6
│       ├── phone.test.js        # Unit 2.6
│       ├── leads.js             # Unit 2.6
│       ├── leads.test.js        # Unit 2.6
│       └── index.js             # Unit 2.7
├── package.json
└── README.md
```

## Phase 3 Architecture: Decision-Maker Email Discovery
The Phase 3 pipeline extends the existing contact discovery process to target top-level decision-makers (Founder, CEO, CTO, etc.) instead of relying purely on generic company emails.

Data Flow Additions:
```
EXISTING PIPELINE (Phase 1 & 2)
  |
  v
Fetch active officers + discover relevant people
  |
  v
NEW: Person-level email discovery
  |
  +---- Public personal email found
  |             |
  |             v
  |      Save exact source URL
  |
  +---- No personal email found
                |
                v
        Collect public emails from same company domain
                |
                v
        Detect common patterns (e.g., first.last@domain)
                |
                v
        Generate likely person email & evaluate signals
                |
                v
        Save as inferred / unknown / invalid
  |
  v
Did we find a usable personal contact?
  |
  +---- YES --> Save eligible person leads to leads.csv
  |
  +---- NO ---> Use publicly found generic company email as fallback (contact_type=company)
  |
  v
EXISTING OUTREACH PIPELINE
  |
  v
Use selected lead's actual recipient
  |
  v
Update sent_leads.csv (Track by company_number + email. We will email ALL discovered top-level decision makers to maximize response rates.)
```

### New Interface Contracts (Phase 3)
- `leads.csv` Schema Additions (Backward compatible):
  - `person_name`, `job_title`, `contact_type`, `email_source_url`, `role_source_url`, `pattern_detected`, `pattern_sample_count`, `pattern_confidence`, `verification_status`, `fallback_used`
- `src/outreach/csv.js` Tracking:
  - Must track sent leads by composite identity (`company_number` + `email`) so sending to one person does not mark all people at the company as sent.

### Decision-Maker Priority List
When discovering and evaluating contacts for outreach, prioritize according to the following weights (P1 to P10). The highest available priority should be chosen to maximize response rates.

| Priority | Role | Suggested Weight | Strategy / Relevance |
|---|---|---|---|
| **P1** | Founder / Co-Founder | 100 | Highest reply chance. In small startups, founders make direct tech hiring/outsourcing decisions. |
| **P2** | CTO / Technical Co-Founder | 95 | High reply chance. Highly relevant for Backend/API/DevOps/Infrastructure pitches. |
| **P3** | CEO / Managing Director | 90 | High-Medium reply chance. Budget/contractor authority, but might delegate tech specifics. |
| **P4** | VP Engineering / Head of Engineering | 85 | Medium-High reply chance. Relevant if the team faces delivery backlogs or API issues. |
| **P5** | Engineering Manager / Backend Lead | 75 | Medium reply chance. Understands technical needs, but may lack final hiring authority. |
| **P6** | COO / Operations Head | 65 | Medium-Low reply chance. Good for business automation, repetitive workflows, integrations. |
| **P7** | IT Director / Head of Technology | 60 | Medium-Low reply chance. Procurement processes might slow down outsourcing decisions. |
| **P8** | Product Manager / CPO | 50 | Low-Medium reply chance. Relevant for specific product feature or delivery delay issues. |
| **P9** | HR / Recruiter | 30 | Low reply chance. Primarily for hiring full-time employees rather than B2B services. |
| **P10** | Generic company inbox (info@ / contact@) | 20 | Low reply chance. Often handled by support/admin teams. Used only as a fallback. |
