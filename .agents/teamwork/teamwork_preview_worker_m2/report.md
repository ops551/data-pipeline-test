# Milestone 2 Implementation Report: Phase 2 Unit 2.4 (Puppeteer Scraping Setup)

**Worker:** `teamwork_preview_worker_m2`  
**Date:** 2026-09-24  
**Project:** Recent UK Companies — Phase 2 Contact Discovery  
**Unit:** Phase 2 Unit 2.4: Puppeteer Scraping Setup  

---

## 1. Executive Summary

Milestone 2 (Phase 2 Unit 2.4) has been successfully implemented and verified following the strict Git workflow required in `docs/working-style.md` and `docs/checklist.md`.

- **Dependencies Installed:** `puppeteer`, `puppeteer-extra`, and `puppeteer-extra-plugin-stealth`.
- **Core Module Created:** `src/enrich/scraper.js`, exporting `createScraper(options)` with full lifecycle management (`fetchHtml`, `search`, `close`, `isClosed`).
- **Resource Optimization:** Request interception aborts `image`, `media`, `font`, and `stylesheet` requests, speeding up page navigation and slashing bandwidth.
- **Search & Link Decoding:** `search(query, options)` queries search endpoints (e.g. DuckDuckGo HTML) and transparently unwraps DuckDuckGo `uddg` redirect URLs into direct destination URLs.
- **Test Suite:** `src/enrich/scraper.test.js` adds 12 comprehensive unit and integration tests (bringing the project test suite from 45 to 57 tests, all passing).
- **Git Delivery:** Branch `phase-2-unit-4` created, committed, pushed, PR #5 opened via `gh pr create --fill`, merged via `gh pr merge --merge`, branch deleted, and `docs/checklist.md` ticked as `[x]` on `main`.

---

## 2. Technical Architecture & Implementation Details

### 2.1 Dependencies & Browser Discovery
In `package.json`:
- `puppeteer` (`^25.12.0`)
- `puppeteer-extra` (`^3.3.6`)
- `puppeteer-extra-plugin-stealth` (`^2.11.2`)

To ensure cross-environment reliability (local workstation, CI runners, Docker containers):
- `resolveExecutablePath(customPath)` checks:
  1. Explicit `options.executablePath`
  2. Environment variable `process.env.PUPPETEER_EXECUTABLE_PATH`
  3. Pre-installed system Google Chrome/Chromium binaries (`/usr/bin/google-chrome-stable`, `/usr/bin/google-chrome`, `/usr/bin/chromium`, `/usr/bin/chromium-browser`)
  4. Falls back to Puppeteer's bundled Chromium if none are present.

### 2.2 Stealth & Headless Linux Launch Arguments
`DEFAULT_LAUNCH_ARGS` are configured to guarantee headless Linux sandboxing compliance and prevent fingerprint detection:
```javascript
const DEFAULT_LAUNCH_ARGS = [
  '--headless=new',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,800',
  '--lang=en-GB,en'
];
```
Stealth is initialized with `puppeteerExtra.use(StealthPlugin())` before launching.

### 2.3 Request Interception & Performance
To maximize scraping speed and minimize memory/CPU load when scraping search engines, social media, and business directories:
- `BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'stylesheet'])`
- When navigating, requests matching blocked types are immediately aborted via `req.abort()`.
- Verified in tests: images and stylesheets are blocked before reaching the server.

### 2.4 Error Handling & Navigation Resiliency
`fetchHtml(url, fetchOptions)`:
- Validates URL syntax and protocol (`http:`, `https:`).
- Supports sensible navigation timeouts (default 25 seconds).
- Distinguishes HTTP error status codes (e.g. 404, 500) from connection/DNS failures: returns `{ html, finalUrl, statusCode: 404 }` without throwing.
- When `throwOnError: false` is provided, navigation/DNS failures return `{ html: '', finalUrl: url, statusCode: 0, error: err.message }` allowing resilient batch processing.
- When `throwOnError` is enabled, throws descriptive error messages (`Invalid URL "..."`, `Failed to navigate to "..."`).
- Safely closes pages in a `finally` block to prevent browser tab leaks.

### 2.5 Search & URL Decoding
`search(query, searchOptions)`:
- Formats queries against DuckDuckGo HTML endpoint: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`.
- Extracts all anchor tags from the response HTML.
- Unwraps DuckDuckGo redirect wrappers (`//duckduckgo.com/l/?uddg=<encoded_url>`), decoding HTML entities (`&amp;`) and extracting clean destination URLs.
- Filters out search engine internal navigation links and anchors.
- Returns `{ html, links, statusCode }`.

---

## 3. Verification & Test Suite

The test suite in `src/enrich/scraper.test.js` covers:
1. `DEFAULT_LAUNCH_ARGS includes required headless Linux flags`: Asserts all required flags are present.
2. `decodeSearchUrl extracts uddg destination and decodes HTML entities`: Verifies DDG redirect unwrapping and entity decoding.
3. `extractLinksFromHtml extracts and filters external URLs`: Tests anchor extraction, duplicate removal, and internal link rejection.
4. `createScraper merges custom launch arguments with mock puppeteer`: Verifies dependency injection and option merging.
5. `resolveExecutablePath prioritizes custom option and environment variable`: Verifies executable path resolution order.
6. `fetchHtml loads page, returns statusCode 200, html and finalUrl`: Spins up local HTTP server and verifies live page content extraction.
7. `fetchHtml returns 404 statusCode without throwing`: Verifies HTTP error status codes are returned cleanly without throwing exceptions.
8. `fetchHtml intercepts and blocks image and stylesheet requests by default`: Verifies that image and stylesheet requests are blocked from reaching the server.
9. `fetchHtml handles invalid URLs and navigation errors gracefully`: Tests protocol rejection, malformed URLs, and `throwOnError: false` behavior.
10. `search queries mock search endpoint and decodes result links`: Verifies query validation, mock search execution, and link extraction.
11. `close cleanly shuts down browser and rejects further calls`: Tests clean shutdown, idempotency, and post-close call rejection.
12. `live search queries DuckDuckGo endpoint and returns html and links`: Executes a real headless query against DuckDuckGo, confirming live HTTP 200 and result extraction.

### Test Execution Output:
```
✔ walks pages with start_index and stops when hits are exhausted (3.056353ms)
✔ stops once maxResults new companies are collected (0.455886ms)
✔ stops on an empty page even if hits says more (1.217827ms)
✔ skips duplicates repeated across pages (0.417205ms)
✔ skips companies passed in as alreadySeen (0.309364ms)
✔ items without a company_number are ignored (2.78693ms)
✔ buildUrl sends only date range, size and start_index (3.297457ms)
✔ 200 returns the body and uses Basic auth with key as username (1.343059ms)
✔ 429 waits until x-ratelimit-reset then retries (0.882682ms)
✔ 429 without reset header waits the fallback 60s (0.928173ms)
✔ 5xx retries with backoff then succeeds (2.538256ms)
✔ network error retries then succeeds (0.803811ms)
✔ gives up after 5 retries on persistent 5xx (2.214711ms)
✔ 401 throws immediately without retry (1.224107ms)
✔ other 4xx throws with status (1.320779ms)
✔ defaults: last 7 days and 1000 results (3.731063ms)
✔ DAYS_BACK changes the from date (0.6831ms)
✔ explicit dates win over DAYS_BACK (0.838152ms)
✔ MAX_RESULTS is read as a number (0.653409ms)
✔ missing or placeholder key throws a clear error (1.287528ms)
✔ only one of the two dates is an error (0.564508ms)
✔ bad date, reversed range and bad numbers are errors (1.094006ms)
✔ toRow maps fields, joins sic codes and flattens the address (2.995372ms)
✔ toRow tolerates missing address and sic codes (0.432086ms)
✔ toLine quotes commas and doubles quotes, flattens newlines (0.71559ms)
✔ appendCompanies writes header once across two runs (3.685872ms)
✔ appendCompanies with no items writes nothing (1.113206ms)
✔ readCompanyNumbers returns empty set when file is missing (1.40011ms)
✔ readCompanyNumbers reads back what appendCompanies wrote, including quoted rows (1.805515ms)
✔ isTargetSic (3.055943ms)
✔ getDaysOld (1.921197ms)
✔ filterCandidates (5.540779ms)
✔ extractActiveDirectors returns empty string for empty or missing input (4.067887ms)
✔ extractActiveDirectors extracts active director and skips resigned or non-director roles (0.793092ms)
✔ extractActiveDirectors handles multiple active directors and corporate directors (1.009004ms)
✔ getCompanyOfficers 200 returns body and calls correct endpoint with basic auth (8.059324ms)
✔ getCompanyOfficers 404 returns empty items without throwing (2.393674ms)
✔ getCompanyOfficers 429 retries using retry-after header (1.488891ms)
✔ getCompanyOfficers 429 retries using x-ratelimit-reset header (1.261987ms)
✔ getCompanyOfficers 500 retries with backoff then succeeds (1.694614ms)
✔ getCompanyOfficers gives up after 5 retries on persistent 5xx (4.362541ms)
✔ getCompanyOfficers network error retries then succeeds (3.857995ms)
✔ getCompanyOfficers 401 throws without retry (1.48058ms)
✔ getDirectorsForCompany fetches officers and extracts active director names (2.518985ms)
✔ getDirectorsForCompany returns empty string for 404 company (1.108026ms)
✔ DEFAULT_LAUNCH_ARGS includes required headless Linux flags (1.087236ms)
✔ decodeSearchUrl extracts uddg destination and decodes HTML entities (0.465287ms)
✔ extractLinksFromHtml extracts and filters external URLs (1.376229ms)
✔ createScraper merges custom launch arguments with mock puppeteer (0.492077ms)
✔ resolveExecutablePath prioritizes custom option and environment variable (0.181962ms)
✔ fetchHtml loads page, returns statusCode 200, html and finalUrl (977.187532ms)
✔ fetchHtml returns 404 statusCode without throwing (611.133975ms)
✔ fetchHtml intercepts and blocks image and stylesheet requests by default (635.886565ms)
✔ fetchHtml handles invalid URLs and navigation errors gracefully (691.234485ms)
✔ search queries mock search endpoint and decodes result links (687.377271ms)
✔ close cleanly shuts down browser and rejects further calls (674.459109ms)
✔ live search queries DuckDuckGo endpoint and returns html and links (1566.950715ms)
ℹ tests 57
ℹ suites 0
ℹ pass 57
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6429.622003
```

---

## 4. Git & Release History

- **Branch:** `phase-2-unit-4` branched from up-to-date `main`.
- **Commit on branch:** `cc1a289 Phase 2 Unit 4: Puppeteer scraping setup`
- **Push:** `git push -u origin phase-2-unit-4`
- **Pull Request:** `https://github.com/Nahid625/Recent-uk-Companys/pull/5`
- **Merge Commit:** `ba9a387 Merge pull request #5 from Nahid625/phase-2-unit-4`
- **Branch Cleanup:** Local and remote `phase-2-unit-4` branches deleted.
- **Checklist Commit on main:** `1e7edeb docs: tick Unit 2.4 in checklist` pushed to `origin/main`.
