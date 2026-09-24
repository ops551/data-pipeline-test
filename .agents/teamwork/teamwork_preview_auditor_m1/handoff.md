# Forensic Integrity Audit Report: Milestone 1 (Unit 2.3)

**Author:** teamwork_preview_auditor_m1  
**Recipient:** parent (0f79dc1f-898f-413d-869e-69d8d047848e)  
**Date:** 2026-09-24  
**Work Product:** Milestone 1 (Phase 2 Unit 2.3: Companies House Officers API)  
**Profile:** General Project  
**Integrity Mode:** development (per `ORIGINAL_REQUEST.md`)  
**Verdict:** **CLEAN**

---

## Executive Summary

Worker M1 implemented Unit 2.3 (`Companies House Officers API`) completely, cleanly, and authentically. There are no hardcoded responses, no mock shortcuts in production code, no facade implementations, and no bypasses. The unit test suite runs 45 tests using Node's native test runner (`node:test`) and passes 100%. Live API queries executed against the official Companies House endpoint (`https://api.company-information.service.gov.uk`) with multiple real UK company numbers successfully returned authentic officer and director data. Git history confirms full compliance with the branch-PR-merge-cleanup workflow (PR #4 merged, branch deleted locally and remotely, checklist updated). Secrets hygiene is strictly preserved (`.env` never staged or committed).

---

## Phase Results

| Check | Result | Details |
|---|---|---|
| **Phase 1.1: Hardcoded Output Detection** | **PASS** | Grep and AST inspection of `src/` revealed 0 occurrences of hardcoded company numbers, names, or mock responses. |
| **Phase 1.2: Facade & Dummy Logic Detection** | **PASS** | `getCompanyOfficers` in `src/companiesHouse.js` and `extractActiveDirectors` in `src/enrich/officers.js` implement genuine network I/O, retry backoff, and data filtering. |
| **Phase 1.3: Pre-populated Artifact Detection** | **PASS** | Zero pre-populated test output logs or fabricated results exist in the repository. |
| **Phase 2.1: Automated Test Suite Execution** | **PASS** | `npm test` executed independently: 45 tests passed across the entire project (13 new tests in `src/enrich/officers.test.js`), 0 failed. |
| **Phase 2.2: Live API Execution & Tracing** | **PASS** | Queried Companies House API for 3 real UK companies (`17454984`, `17454977`, `17454986`) and 1 invalid (`00000000`). All returned authentic live records and expected director names. |
| **Phase 3.1: Git Workflow & PR Hygiene** | **PASS** | Dedicated branch `phase-2-unit-3` created, committed `7068002`, PR #4 opened, CI passed (13s), merged into `main`, and branch deleted. |
| **Phase 3.2: Checklist & Docs Update** | **PASS** | Commit `538a829` on `main` ticked Unit 2.3 in `docs/checklist.md`. |
| **Phase 3.3: Secret Hygiene & Git Tracking** | **PASS** | `.env` was never staged or tracked in Git; properly ignored in `.gitignore`. |

---

## 5-Component Handoff

### 1. Observation

1. **Static Analysis of Source Code**:
   - `src/companiesHouse.js`:
     - Lines 23-32: `rateLimitWaitMs(response, now)` calculates sleep duration using `retry-after` header if present (converted to ms), then `x-ratelimit-reset` header, falling back to 60,000ms.
     - Lines 80-90: `getApiKey(deps)` resolves API key safely from dependency injection, `process.env.COMPANIES_HOUSE_API_KEY`, or `loadConfig().apiKey`.
     - Lines 92-145: `getCompanyOfficers(companyNumber, deps)` constructs endpoint `new URL('/company/' + encodeURIComponent(companyNumber) + '/officers', BASE_URL)`. Sends `Authorization: authHeader(apiKey)`. On 404 returns `{ items: [], total_results: 0, active_count: 0 }`. On 429 waits and retries up to 5 times. On 5xx retries with exponential backoff up to 5 times. On network errors retries up to 5 times.
   - `src/enrich/officers.js`:
     - Lines 3-18: `extractActiveDirectors(officersList)` handles null/undefined/array/object with `.items`. Filters for `!officer.resigned_on && officer.officer_role && officer.officer_role.toLowerCase().includes('director')`. Extracts `.name`, trims, filters empty values, and joins with `', '`.
     - Lines 20-24: `getDirectorsForCompany(companyNumber, deps)` invokes `getCompanyOfficers` and delegates parsing to `extractActiveDirectors`.
   - `src/enrich/officers.test.js`:
     - Lines 1-167: 13 unit tests verifying pure logic, 200 responses, 404 responses, 429 retry backoff with `retry-after`, 429 retry backoff with `x-ratelimit-reset`, 500 retry backoff, 500 retry exhaustion, network error retries, 401 unauthenticated errors, and corporate director filtering.
   - No hardcoded company numbers (e.g. `17454984`) or names (e.g. `Mujammil`) exist in `src/`.

2. **Test Suite Execution**:
   - Running `npm test`:
     ```
     > node --test
     ✔ walks pages with start_index and stops when hits are exhausted (3.19ms)
     ...
     ✔ extractActiveDirectors returns empty string for empty or missing input (3.51ms)
     ✔ extractActiveDirectors extracts active director and skips resigned or non-director roles (1.16ms)
     ✔ extractActiveDirectors handles multiple active directors and corporate directors (0.46ms)
     ✔ getCompanyOfficers 200 returns body and calls correct endpoint with basic auth (6.88ms)
     ✔ getCompanyOfficers 404 returns empty items without throwing (2.32ms)
     ✔ getCompanyOfficers 429 retries using retry-after header (1.50ms)
     ✔ getCompanyOfficers 429 retries using x-ratelimit-reset header (2.89ms)
     ✔ getCompanyOfficers 500 retries with backoff then succeeds (1.80ms)
     ✔ getCompanyOfficers gives up after 5 retries on persistent 5xx (3.59ms)
     ✔ getCompanyOfficers network error retries then succeeds (3.68ms)
     ✔ getCompanyOfficers 401 throws without retry (0.74ms)
     ✔ getDirectorsForCompany fetches officers and extracts active director names (1.79ms)
     ✔ getDirectorsForCompany returns empty string for 404 company (2.63ms)
     ℹ tests 45
     ℹ suites 0
     ℹ pass 45
     ℹ fail 0
     ℹ cancelled 0
     ℹ skipped 0
     ℹ todo 0
     ℹ duration_ms 233.805498
     ```

3. **Live API Execution**:
   - Independent script executed against Companies House live API:
     ```json
     {
       "company": "17454984",
       "raw_active_count": 1,
       "raw_total_results": 1,
       "officers": [
         {
           "name": "AHMED, Mujammil",
           "role": "director"
         }
       ],
       "directors": "AHMED, Mujammil"
     }
     {
       "company": "17454977",
       "raw_active_count": 1,
       "raw_total_results": 1,
       "officers": [
         {
           "name": "GOODACRE, Jon",
           "role": "director"
         }
       ],
       "directors": "GOODACRE, Jon"
     }
     {
       "company": "17454986",
       "raw_active_count": 1,
       "raw_total_results": 1,
       "officers": [
         {
           "name": "JOHNSON, Gerard David",
           "role": "director"
         }
       ],
       "directors": "JOHNSON, Gerard David"
     }
     {
       "company": "00000000",
       "raw_active_count": 0,
       "raw_total_results": 0,
       "officers": [],
       "directors": ""
     }
     ```

4. **Git Forensics & GitHub PR #4**:
   - `git log -n 5 --graph --oneline`:
     ```
     * 538a829 (HEAD -> main, origin/main, origin/HEAD) docs: tick Unit 2.3 in checklist
     *   e5200a2 Merge pull request #4 from Nahid625/phase-2-unit-3
     |\  
     | * 7068002 Phase 2 Unit 3: Companies House Officers API integration
     |/  
     *   9b1838b Merge pull request #3 from Nahid625/phase-2-unit-2
     ```
   - `gh pr view 4`:
     - Status: `MERGED`
     - Commits: `7068002`
     - Changes: `+268 -1`
   - `gh pr checks 4`:
     - Check: `Node.js CI/build (pull_request)` elapsed `13s` -> `successful`.
   - `git branch -a`:
     - Branch `phase-2-unit-3` deleted locally and remotely. Only `main` and `origin/main` exist.
   - `docs/checklist.md`:
     - Row `2.3` marked `[x]`.
   - `git status --ignored`:
     - `.env` is ignored by `.gitignore` and has never been committed.

### 2. Logic Chain

1. From Observation 1, static code inspection confirms that `getCompanyOfficers` and `extractActiveDirectors` implement genuine API interaction, error handling, and string parsing logic without hardcoded cheats or facade shortcuts.
2. From Observation 2, running `npm test` independently confirms that all 45 automated tests execute and pass without failure.
3. From Observation 3, live API testing using multiple distinct UK company numbers confirms genuine HTTPS network communication with the official Companies House API endpoint and accurate director name extraction.
4. From Observation 4, git history and GitHub CLI queries confirm strict adherence to `docs/working-style.md` and `ORIGINAL_REQUEST.md`: branch creation (`phase-2-unit-3`), PR creation (#4), CI pass, merge into `main`, branch deletion, and checklist ticking on `main`.
5. Therefore, the implementation is authentic, complete, robust, and verified.

### 3. Caveats

- Companies House returns HTTP 404 for company numbers that do not have officer records or are invalid. The code gracefully returns `{ items: [], total_results: 0, active_count: 0 }`, which translates to an empty director name string `""`. This matches the requirement to prevent pipeline crashes during batch enrichment.
- Puppeteer scraping setup is deferred to Milestone 2 (Unit 2.4), per the project roadmap.

### 4. Conclusion

**Verdict: CLEAN.**  
Milestone 1 (Unit 2.3) satisfies all requirements of `ORIGINAL_REQUEST.md`, `PROJECT.md`, `docs/checklist.md`, and `docs/working-style.md`. There are zero integrity violations. The work product is approved.

### 5. Verification Method

To reproduce and independently verify these findings:

1. **Verify Unit Tests**:
   ```bash
   npm test
   ```
   *Expected:* 45 tests pass, 0 fail.

2. **Verify Live Companies House Integration**:
   ```bash
   node -e "
   const { getDirectorsForCompany } = require('./src/enrich/officers');
   Promise.all([
     getDirectorsForCompany('17454984'),
     getDirectorsForCompany('17454977'),
     getDirectorsForCompany('17454986')
   ]).then(([d1, d2, d3]) => {
     console.log('17454984:', d1);
     console.log('17454977:', d2);
     console.log('17454986:', d3);
     if (d1 === 'AHMED, Mujammil' && d2 === 'GOODACRE, Jon' && d3 === 'JOHNSON, Gerard David') {
       console.log('VERIFIED');
       process.exit(0);
     }
     process.exit(1);
   });
   "
   ```

3. **Verify Git & PR State**:
   ```bash
   git status
   git branch -a
   git log -n 3 --oneline
   gh pr view 4
   ```
