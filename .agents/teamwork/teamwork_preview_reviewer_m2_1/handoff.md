# Review & Adversarial Challenge Report: Phase 2 Unit 2.4 (Puppeteer Scraping Setup)

**Author:** `teamwork_preview_reviewer_m2_1`  
**Roles:** reviewer, critic  
**Date:** 2026-09-24  
**Milestone:** Milestone 2 (Phase 2 Unit 2.4: Puppeteer Scraping Setup)  
**Verdict:** **APPROVE**  

---

## 1. Observation

1. **Test Suite Verification**:
   Command: `npm test`
   Result:
   ```
   ℹ tests 57
   ℹ suites 0
   ℹ pass 57
   ℹ fail 0
   ℹ cancelled 0
   ℹ skipped 0
   ℹ todo 0
   ℹ duration_ms 6886.652994
   ```
   All 57 tests passed, including all 12 tests in `src/enrich/scraper.test.js` and all 45 prior tests in `src/collect.test.js`, `src/companiesHouse.test.js`, `src/config.test.js`, `src/csv.test.js`, `src/enrich/filter.test.js`, and `src/enrich/officers.test.js`.

2. **Source Code Implementation (`src/enrich/scraper.js`)**:
   - Lines 2–5: `puppeteerExtra.use(StealthPlugin());` registers evasion plugin before browser launches.
   - Lines 7–17: `DEFAULT_LAUNCH_ARGS` sets `--headless=new`, `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`, `--no-first-run`, `--no-default-browser-check`, `--window-size=1280,800`, and `--lang=en-GB,en`.
   - Line 19 & Lines 124–134: `BLOCKED_RESOURCE_TYPES` (`image`, `media`, `font`, `stylesheet`) are aborted on `request` event with `.catch(() => {})`, while non-blocked requests are continued with `.catch(() => {})`.
   - Lines 120–157: In `fetchHtml`, `page` is allocated via `await browser.newPage()` and enclosed in a `try ... finally` block where `finally { await page.close().catch(() => {}); }` guarantees page disposal regardless of outcome.
   - Lines 185–189: In `close()`, idempotency is protected via `if (isClosed) return; isClosed = true; await browser.close();`.
   - Lines 33–43: `decodeSearchUrl` parses incoming links, unwraps DuckDuckGo's `uddg` parameter via `decodeURIComponent`, and decodes HTML entities (`&amp;` -> `&`).
   - Lines 57–73: `extractLinksFromHtml` extracts `<a>` links matching `/http[s]?:\/\//`, ignores anchor/javascript fragments, decodes `uddg` wrappers, and filters out internal DuckDuckGo URLs.

3. **Process Cleanup & Zombie Process Check**:
   Command: `ps aux | grep -E "(chrome|chromium|puppeteer)" | grep -v grep || true`
   Result: Zero orphan/zombie Google Chrome or Chromium processes left running after test execution. Only the host development environment's native editor processes were present.

4. **Git Operations & Pull Request**:
   - `git status` output on `main`:
     ```
     On branch main
     Your branch is up to date with 'origin/main'.
     ```
   - `git log -n 5 --oneline`:
     ```
     1e7edeb (HEAD -> main, origin/main, origin/HEAD) docs: tick Unit 2.4 in checklist
     ba9a387 Merge pull request #5 from Nahid625/phase-2-unit-4
     cc1a289 Phase 2 Unit 4: Puppeteer scraping setup
     538a829 docs: tick Unit 2.3 in checklist
     e5200a2 Merge pull request #4 from Nahid625/phase-2-unit-3
     ```
   - `gh pr view 5`:
     ```
     Phase 2 Unit 4: Puppeteer scraping setup Nahid625/Recent-uk-Companys#5
     Merged • Nahid625 (Nahid) wants to merge 1 commit into main from phase-2-unit-4 • about 3 minutes ago
     +1361 -2 • ✓ Checks passing
     ```
   - `git branch -a`: Only `main` and `remotes/origin/main` exist. The feature branch `phase-2-unit-4` was cleanly deleted locally and on GitHub.
   - `docs/checklist.md` line 45: Unit 2.4 status is updated to `[x]`.
   - Secret hygiene: `.env` is uncommitted and listed in `.gitignore`.

5. **Live DuckDuckGo Scraping Check**:
   Independent Node invocation of `createScraper().search('Companies House UK')`:
   - Status: HTTP 200
   - Links retrieved: 10 clean destination URLs (e.g. `https://www.gov.uk/government/organisations/companies-house`, `https://find-and-update.company-information.service.gov.uk/`).
   - Browser shut down cleanly within 2.1s without warning.

---

## 2. Logic Chain

1. **Correctness & Requirements Conformance**:
   - Per `PROJECT.md` line 45 and `docs/checklist.md` line 45, Unit 2.4 mandates setting up Puppeteer and stealth scraping capabilities to search DuckDuckGo/Google and scrape pages.
   - Direct observation of `src/enrich/scraper.js` confirms full implementation of `createScraper`, `fetchHtml`, `search`, and `close`.
   - Request interception for images/fonts/stylesheets was independently verified via `src/enrich/scraper.test.js` test 8 (Observation 1 & 2), proving zero network traffic wasted on media.
   - DuckDuckGo URL unwrapping and link extraction were directly verified against both local mock servers and live DDG queries (Observation 1 & 5).

2. **Resource Management & Robustness**:
   - The primary operational failure mode in Puppeteer scraping systems is zombie Chrome processes from aborted requests or hung navigations.
   - Direct observation of lines 120–157 in `src/enrich/scraper.js` shows that `page.close().catch(() => {})` is wrapped in `finally`, guaranteeing that every page created is destroyed.
   - Observation 3 verified that running all 12 Puppeteer tests left zero running browser processes.
   - The `close()` method is idempotent, preventing uncaught rejections when called multiple times.

3. **Integrity & Cheating Audit**:
   - Source code analysis confirmed no hardcoded search results, dummy stub returns, or fabricated data.
   - Test suites execute against real local HTTP servers and real Puppeteer instances.
   - Git commits and PR #5 were genuinely merged with passing checks.

4. **Workflow Compliance**:
   - `docs/working-style.md` requires dedicated branches, commits, PR creation, merge, branch deletion, and checklist ticking.
   - Observations 4 confirmed that PR #5 was created, merged, the branch deleted, and `docs/checklist.md` ticked on `main` via commit `1e7edeb`.

---

## 3. Caveats & Adversarial Challenges

### Challenge 1: DuckDuckGo Rate-Limiting & Jitter (Milestone 3 & Milestone 5)
- **Risk Level**: Medium
- **Assumption Challenged**: Calling `scraper.search` repeatedly in a loop against DuckDuckGo will reliably return search results.
- **Attack Scenario**: DuckDuckGo's HTML endpoint (`html.duckduckgo.com/html/`) issues HTTP 403 or 202 when queried too quickly from a single IP address without delays.
- **Blast Radius**: Searches during batch enrichment (Unit 2.5 and Unit 2.7) could return 0 links if executed in a tight loop.
- **Mitigation**: When implementing `src/enrich/search.js` (Unit 2.5) and `src/enrich/index.js` (Unit 2.7), implement sequential processing with random jitter (2–4 seconds) and consider caching search results on disk. In `scraper.js`, `throwOnError: false` already ensures errors don't crash the scraper.

### Challenge 2: Sequential Page Navigation vs Concurrency
- **Risk Level**: Low
- **Assumption Challenged**: Multiple `fetchHtml` calls can be launched simultaneously.
- **Attack Scenario**: Calling `fetchHtml` concurrently via `Promise.all` across dozens of candidate companies opens multiple simultaneous Chromium tabs, causing high memory usage.
- **Blast Radius**: High RAM usage or Chromium tab crashes.
- **Mitigation**: `PROJECT.md` specifies that candidate companies are processed sequentially. Downstream workers for Unit 2.5 and 2.7 must maintain sequential iteration.

### Challenge 3: SSL Certificate Tolerance on Small Business Websites
- **Risk Level**: Low
- **Assumption Challenged**: External websites and directories will have valid, unexpired SSL certificates.
- **Attack Scenario**: Small business websites or obscure directories may have expired or self-signed certificates, causing Puppeteer navigation to fail with `net::ERR_CERT_AUTHORITY_INVALID`.
- **Blast Radius**: Missed contact extraction on valid small business targets.
- **Mitigation**: For Unit 2.5 page extraction, passing `--ignore-certificate-errors` in launch args or handling status `0` gracefully ensures the pipeline remains resilient.

---

## 4. Conclusion

**Verdict: APPROVE**

The implementation of Phase 2 Unit 2.4 (Puppeteer Scraping Setup) in `src/enrich/scraper.js` is clean, robust, and safe:
1. Launch configuration and stealth evasion are properly configured for Linux headless execution.
2. Resource blocking (fonts, images, media, stylesheets) drops unnecessary overhead.
3. Browser lifecycle management and page disposal in `try ... finally` prevent memory leaks and zombie processes.
4. All 57 tests pass with 0 failures.
5. PR #5 was cleanly merged into `main`, the branch deleted, and `docs/checklist.md` ticked.
6. No integrity violations or shortcuts were detected.

The codebase is fully ready to proceed to Milestone 3 (Phase 2 Unit 2.5: Search & Social Extraction).

---

## 5. Verification Method

To independently reproduce and verify this review:

1. **Verify git status and commits**:
   ```bash
   git status
   git log -n 5 --oneline
   git branch -a
   ```
   Confirm `main` is up to date with `origin/main` at commit `1e7edeb`, and no lingering `phase-2-unit-4` branch exists.

2. **Verify PR status**:
   ```bash
   gh pr view 5
   ```
   Confirm PR #5 is in `MERGED` state.

3. **Run test suite**:
   ```bash
   npm test
   ```
   Confirm all 57 tests pass with 0 failures.

4. **Verify process cleanup**:
   ```bash
   ps aux | grep -E "(chrome|chromium)" | grep -v grep || true
   ```
   Confirm no zombie Chrome processes remain.
