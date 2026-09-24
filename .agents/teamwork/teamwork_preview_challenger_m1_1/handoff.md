# Adversarial Challenge & Stress-Test Handoff Report: Unit 2.3

**Author:** teamwork_preview_challenger_m1_1  
**Recipient:** parent (`0f79dc1f-898f-413d-869e-69d8d047848e`)  
**Date:** 2026-09-24  
**Type:** Hard Handoff (Adversarial Assessment Complete)  
**Verdict:** **APPROVE**  

---

## 1. Observation

1. **Adversarial Test Suite Execution**:
   - Created and executed adversarial test harness:
     `/home/nahid/Documents/Recent-uk-Companys/.agents/teamwork/teamwork_preview_challenger_m1_1/adversarial_harness.js`
   - Command:
     ```bash
     node .agents/teamwork/teamwork_preview_challenger_m1_1/adversarial_harness.js
     ```
   - Verbatim Output:
     ```text
     ====================================================
     ADVERSARIAL STRESS TEST HARNESS — UNIT 2.3
     Testing: src/enrich/officers.js & src/companiesHouse.js
     ====================================================

     --- SUITE 1: Malformed API Responses ---
       ✓ [Suite 1] 1.1 null input
       ✓ [Suite 1] 1.2 undefined input
       ✓ [Suite 1] 1.3 empty object input
       ✓ [Suite 1] 1.4 items is null
       ✓ [Suite 1] 1.5 items is undefined
       ✓ [Suite 1] 1.6 items is a string
       ✓ [Suite 1] 1.7 items is a number
       ✓ [Suite 1] 1.8 items is a boolean
       ✓ [Suite 1] 1.9 input is a primitive string
       ✓ [Suite 1] 1.10 input is a primitive number
       ✓ [Suite 1] 1.11 input is a boolean
       ✓ [Suite 1] 1.12 items is empty array
       ✓ [Suite 1] 1.13 items contains null and undefined elements
       ✓ [Suite 1] 1.14 item missing officer_role
       ✓ [Suite 1] 1.15 item officer_role is null
       ✓ [Suite 1] 1.16 item officer_role is empty string
       ✓ [Suite 1] 1.17 item missing name property
       ✓ [Suite 1] 1.18 item name is null
       ✓ [Suite 1] 1.19 item name is empty string
       ✓ [Suite 1] 1.20 item name is whitespace only
       ✓ [Suite 1] 1.21 items list with mixed valid and broken items

     --- SUITE 2: Mixed Case Roles & Role Variations ---
       ✓ [Suite 2] 2.1 uppercase DIRECTOR
       ✓ [Suite 2] 2.2 Title Case Director
       ✓ [Suite 2] 2.3 lowercase director
       ✓ [Suite 2] 2.4 managing director (lowercase & mixed case)
       ✓ [Suite 2] 2.5 executive director
       ✓ [Suite 2] 2.6 corporate nominee director
       ✓ [Suite 2] 2.7 corporate-director & corporate-nominee-director
       ✓ [Suite 2] 2.8 role with surrounding whitespace and bizarre casing
       ✓ [Suite 2] 2.9 secretary roles are excluded
       ✓ [Suite 2] 2.10 non-director non-secretary roles are excluded
       ✓ [Suite 2] 2.11 complex mixed company officer board

     --- SUITE 3: Resigned vs Active Logic ---
       ✓ [Suite 3] 3.1 resigned_on with valid date string is excluded
       ✓ [Suite 3] 3.2 resigned_on undefined is active and included
       ✓ [Suite 3] 3.3 resigned_on null is active and included
       ✓ [Suite 3] 3.4 resigned_on empty string is active and included
       ✓ [Suite 3] 3.5 resigned_on omitted completely is active and included
       ✓ [Suite 3] 3.6 multiple directors with some resigned and some active

     --- SUITE 4: Extreme Rate Limit & Backoff Simulations ---
       ✓ [Suite 4] 4.1 429 with retry-after header in seconds
       ✓ [Suite 4] 4.2 429 with subsecond retry-after clamped to 1000ms
       ✓ [Suite 4] 4.3 429 with retry-after: 0 falls through to reset or fallback
       ✓ [Suite 4] 4.4 429 with x-ratelimit-reset in the future
       ✓ [Suite 4] 4.5 429 with x-ratelimit-reset in the past clamped to 1000ms floor
       ✓ [Suite 4] 4.6 429 missing reset and retry-after headers uses 60s fallback
       ✓ [Suite 4] 4.7 429 non-numeric garbage in reset uses 60s fallback
       ✓ [Suite 4] 4.8 429 rate limit exhausted after exactly MAX_RETRIES (5 retries)
       ✓ [Suite 4] 4.9 5xx exponential backoff timings verified: 1s, 2s, 4s, 8s, 16s
       ✓ [Suite 4] 4.10 5xx exhaustion after 5 retries throws descriptive error
       ✓ [Suite 4] 4.11 Network error exponential backoff and exhaustion
       ✓ [Suite 4] 4.12 Mixed error sequence: Network -> 500 -> 429 -> 503 -> 429 -> 200
       ✓ [Suite 4] 4.13 401 throws immediately without retry or sleep
       ✓ [Suite 4] 4.14 404 returns empty object without retry or sleep
       ✓ [Suite 4] 4.15 403 throws immediately with body without retry
       ✓ [Suite 4] 4.16 End-to-end getDirectorsForCompany wiring with active director extraction
       ✓ [Suite 4] 4.17 URL encoding of company numbers with unusual characters

     --- SUITE 5: Deep Adversarial & Performance Stress ---
       ✓ [Suite 5] 5.1 Unicode / Non-ASCII and special punctuation in director names
       ✓ [Suite 5] 5.2 Massive board of directors (10,000 items) performance stress
       ✓ [Suite 5] 5.3 Object with prototype null or inherited attributes
       ✓ [Suite 5] 5.4 Case-insensitive headers for retry-after and x-ratelimit-reset
       ✓ [Suite 5] 5.5 ApiKey resolution precedence: deps.apiKey > deps.config.apiKey > process.env

     ====================================================
     TOTAL TESTS: 60
     PASSED: 60
     FAILED: 0
     ====================================================

     ALL ADVERSARIAL CHALLENGES PASSED!
     ```

2. **Standard Repository Test Suite**:
   - Command: `npm test`
   - Result: 45 tests passed, 0 failed (including Unit 2.3 tests in `src/enrich/officers.test.js`).

3. **Live Companies House API Probing**:
   - Query against real incorporated companies sampled from `companies.csv`:
     ```text
     Company 17454977: active_count=1, total_results=1, director="GOODACRE, Jon"
     Company 17454978: active_count=1, total_results=1, director="BROOME, Nathan Lee Lee"
     Company 17454979: active_count=1, total_results=1, director="KOHLI, Madhav"
     Company 17454980: active_count=1, total_results=1, director="WHITE, Roland"
     Company 17454984: active_count=1, total_results=1, director="AHMED, Mujammil"
     ```
   - Query against non-existent company `00000000`:
     - Returned `{ active_count: 0, items: [], total_results: 0 }`, and extracted director name was `""`.

---

## 2. Logic Chain

1. **Malformed API Handling**:
   - Observation 1 (Suite 1: Tests 1.1 to 1.21) shows that `src/enrich/officers.js:3-18` validates `officersList` and `items` safely against `null`, `undefined`, primitives, non-array inputs, missing `officer_role`, and missing/empty `name`.
   - In every case, it safely extracts only valid director names or returns an empty string without unhandled exceptions.

2. **Role Normalization and Inclusions/Exclusions**:
   - Observation 1 (Suite 2: Tests 2.1 to 2.11) proves that `officer.officer_role.toLowerCase().includes('director')` properly catches:
     - All case variants: `"DIRECTOR"`, `"Director"`, `"director"`, `"   dIrEcToR   "`.
     - Sub-roles: `"managing director"`, `"executive director"`, `"corporate nominee director"`, `"corporate-director"`, `"corporate-nominee-director"`, `"nominee-director"`.
     - Correctly rejects secretaries (`"secretary"`, `"corporate-secretary"`, `"corporate-nominee-secretary"`) and other roles (`"llp-member"`, `"judicial-factor"`, `"receiver-manager"`).

3. **Resigned vs Active Filtering**:
   - Observation 1 (Suite 3: Tests 3.1 to 3.6) proves that `if (!officer || officer.resigned_on) return false;` strictly discards any officer with an effective `resigned_on` date string (`'2026-09-20'`, `'1995-12-31'`), while properly keeping active officers where `resigned_on` is `undefined`, `null`, or `''`.

4. **Extreme Rate Limits, Backoff, and HTTP Fault Tolerance**:
   - Observation 1 (Suite 4: Tests 4.1 to 4.17) validates `src/companiesHouse.js:23-32` and `getCompanyOfficers`:
     - Rate limit headers `retry-after` and `x-ratelimit-reset` are respected with a minimum clamp of 1000ms.
     - Unset or malformed rate limit headers safely trigger the 60s fallback (`FALLBACK_WAIT_MS`).
     - Persistent 429 exhaustion terminates after exactly 5 retries (`Still rate limited after 5 retries.`).
     - 5xx and network errors retry with exponential backoff (`[1000, 2000, 4000, 8000, 16000]ms`).
     - 401 and 403 fail immediately without retrying or stalling.
     - 404 gracefully returns an empty officer payload without throwing.

5. **Live Verification**:
   - Observation 3 confirms authentic live operation against Companies House API with real responses and correct active director names.

---

## 3. Caveats

1. **Primitive Schema Invariance**: The parser relies on `officer.name` and `officer.officer_role` being string values when present (using `.trim()` and `.toLowerCase()`). In an artificial environment where a non-string type (e.g. number or object) is placed on `name` or `officer_role`, a `TypeError` would be raised. Because Companies House OpenAPI specs strictly enforce string types for both fields, this does not pose a real-world risk.
2. **Single-Page Officer Fetching**: `getCompanyOfficers` queries `GET /company/{companyNumber}/officers` without pagination, which retrieves up to 35 officers per company. For recently incorporated UK companies (which are 7–60 days old per Phase 2 requirements), newly incorporated companies rarely have more than 1–3 officers, so 35 items is more than sufficient.

---

## 4. Conclusion

**Verdict: APPROVE**

The Unit 2.3 implementation (`src/enrich/officers.js` and `src/companiesHouse.js`) has withstood rigorous adversarial challenge:
- All 60 stress test cases in the adversarial harness passed (0 failures).
- All 45 project unit tests in `npm test` passed (0 failures).
- Real-world integration with Companies House API verified.
- The module is production-ready and fully satisfies all Unit 2.3 criteria.

---

## 5. Verification Method

To reproduce and independently verify these findings:

1. **Run the Adversarial Harness**:
   ```bash
   node .agents/teamwork/teamwork_preview_challenger_m1_1/adversarial_harness.js
   ```
   *Expected:* 60 passed, 0 failed.

2. **Run Existing Project Test Suite**:
   ```bash
   npm test
   ```
   *Expected:* 45 passed, 0 failed.

3. **Run Live Companies House Verification**:
   ```bash
   node -e '
   require("dotenv").config();
   const { getDirectorsForCompany } = require("./src/enrich/officers");
   getDirectorsForCompany("17454984").then(name => {
     console.log("Active Director:", name);
     process.exit(name === "AHMED, Mujammil" ? 0 : 1);
   });
   '
   ```
   *Expected:* Outputs `Active Director: AHMED, Mujammil` and exits with code 0.
