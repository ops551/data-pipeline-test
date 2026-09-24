# Empirical Challenge & Verification Report: Unit 2.4 (src/enrich/scraper.js)

**Verdict**: **FAIL** (DuckDuckGo HTML endpoint anti-bot block triggered; navigation & browser lifecycle APPROVED)

---

## 1. Observation

### 1.1 Automated Test Suite
- Command executed: `npm test`
- Result: 57 tests passed (duration: 6410ms, exit code 0).
- Relevant test in `src/enrich/scraper.test.js:267-280`:
  ```javascript
  test('live search queries DuckDuckGo endpoint and returns html and links', async () => { ... });
  ```
  This test only queries a single search `"Companies House UK"` and ignores non-200 responses with an `if (res.statusCode === 200)` guard, masking status 202 bot challenges.

### 1.2 Live Navigation & Lifecycle Verification (`fetchHtml`)
- Target: `https://example.com`
- Browser version: `Chrome/153.0.8010.47` with `puppeteer-extra-plugin-stealth`
- Status code: `200`
- Final URL: `https://example.com/`
- HTML length: 559 bytes; contains `<h1>Example Domain</h1>`
- Page cleanup & leak check:
  - Baseline browser pages: `1`
  - Pages after single navigation: `1`
  - Pages after 10 sequential navigations: `1` (zero page leaks)
  - Pages after 5 concurrent navigations: `1` (zero page leaks)
  - Navigation error handling (404 and unreachable hostname `http://invalid-subdomain-that-does-not-exist-123456.org`): Handled without crashing; page cleaned up in `finally` block (`pages = 1`).

### 1.3 Live DuckDuckGo HTML Endpoint Searches
- Default implementation in `src/enrich/scraper.js:168-170`:
  ```javascript
  const searchUrl =
    searchOptions.searchUrl ||
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.trim())}`;
  ```
- Test query 1: `"TESCO STORES LIMITED" "AL7 1GA"`
  - Status code: `200`
  - HTML length: 28,950 bytes
  - Extracted links count: 7
  - Sample extracted link: `https://opengovuk.com/company/00519500`
  - URL unwrapping: `decodeSearchUrl()` successfully decoded `uddg` parameters and HTML entities (`&amp;` -> `&`).
- Test query 2 (consecutive search): `"BARCLAYS BANK PLC"`
  - Status code: `202` (HTTP 202 Accepted)
  - HTML length: 14,321 bytes
  - Extracted links count: `0`
  - Verbatim HTML content lines 33-39:
    ```html
    <form id="challenge-form" action="//duckduckgo.com/anomaly.js?sv=html&amp;cc=sre&amp;st=1790237349&amp;gk=d4cd0dabcf4caa22ad92fab40844c786&amp;p=26a75" ...>
    <div class="anomaly-modal__mask">
    <div class="anomaly-modal__modal is-ie" data-testid="anomaly-modal">
    <div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div>
    <div class="anomaly-modal__description">Please complete the following challenge to confirm this search was made by a human.</div>
    <div class="anomaly-modal__instructions">Select all squares containing a duck:</div>
    ```
- Sequence test: 5 consecutive searches with 3-second delays (`"TESCO..."`, `"BARCLAYS..."`, `"VODAFONE..."`, `"SAINSBURY'S..."`, `"MARKS AND SPENCER..."`):
  - 5 out of 5 queries returned `Status: 202, Links: 0, Blocked: true`.

### 1.4 Comparative Stealth Test on Standard DuckDuckGo Web Endpoint
- Target: `https://duckduckgo.com/?q=${encodeURIComponent(query)}` with `waitUntil: 'networkidle2'`
- Test query 1: `"TESCO STORES LIMITED" "AL7 1GA"`:
  - Status code: `200`, Blocked: `false`, Extracted links: `13`
- Test query 2: `"BARCLAYS BANK PLC"`:
  - Status code: `200`, Blocked: `false`, Extracted links: `16`
- Test query 3: `"VODAFONE LIMITED"`:
  - Status code: `200`, Blocked: `false`, Extracted links: `17`
- The `puppeteer-extra-plugin-stealth` configuration successfully evades bot detection on the standard JavaScript-rendered search interface (`duckduckgo.com`), but fails on the static non-JS endpoint (`html.duckduckgo.com`).

---

## 2. Logic Chain

1. **Observation 1.2** proves that the headless browser configuration, stealth plugin registration, Linux launch arguments, resource blocking (images/stylesheets/fonts), and `fetchHtml()` page lifecycle management operate cleanly with zero page leaks across sequential and concurrent runs.
2. **Observation 1.3** proves that `scraper.search()` defaults to `https://html.duckduckgo.com/html/?q=...`.
3. When querying this static endpoint, DuckDuckGo detects automated requests and immediately serves an interactive CAPTCHA puzzle (`"Unfortunately, bots use DuckDuckGo too... Select all squares containing a duck"` with HTTP 202).
4. As a result, query 2 (`"BARCLAYS BANK PLC"`) and all subsequent queries in a pipeline sequence yield 0 search results and fail to discover destination URLs.
5. In Phase 2 (`docs/path.md` line 29), the scraper is intended to process hundreds or thousands of candidate companies to bypass search quotas. The current default endpoint halts almost immediately due to CAPTCHA challenges.
6. Acceptance Criterion 2 of the Challenger task explicitly states: *"Verify that DuckDuckGo HTML is retrieved, search results are found, destination URLs are unwrapped from uddg wrappers, and no anti-bot or CAPTCHA block was triggered."*
7. Because an anti-bot CAPTCHA block was triggered on realistic UK company queries, the criterion is violated.
8. Conversely, **Observation 1.4** demonstrates that routing queries through the standard DuckDuckGo search endpoint (`https://duckduckgo.com/?q=...`) with `networkidle2` resolves the block completely and returns full results.

---

## 3. Caveats

- **IP Reputation**: The test was conducted from the current runner IP address. An IP with high reputation might tolerate 2-3 queries before triggering the duck puzzle on `html.duckduckgo.com`, but the rate-limiting on that specific subdomain remains strict.
- **Query Latency**: Rendering the full standard interface (`https://duckduckgo.com/?q=...`) with `networkidle2` takes ~1.5–2.0 seconds per query, compared to ~300ms for static HTML. However, 2.0s for 100% valid results is vastly superior to 300ms for 0 results and a CAPTCHA wall.
- **Scope Restriction**: Per Teamwork Review-only constraints, no changes were committed to `src/enrich/scraper.js`. The fix is recommended for Unit 2.5 (`src/enrich/search.js`) or a non-breaking update to `search()` default parameters.

---

## 4. Conclusion

- **Verdict**: **FAIL**
- **Specific Failure**: DuckDuckGo HTML endpoint (`https://html.duckduckgo.com/html/`) triggered HTTP 202 and interactive CAPTCHA blocks (`anomaly-modal`) on realistic UK company search queries (e.g. `"BARCLAYS BANK PLC"`), failing Criterion 2.
- **Approved Components**:
  - Headless browser initialization with Stealth plugin (`Chrome/153.0.8010.47`)
  - Resource blocking (CSS, images, fonts, media)
  - Navigation via `fetchHtml()` (200 OK, proper error handling for 404/DNS)
  - Page lifecycle cleanup (zero page leaks across sequential and concurrent runs)
  - `decodeSearchUrl()` URL parameter unwrapping and HTML unescaping
- **Actionable Recommendation for Developer / Next Unit**:
  In `src/enrich/scraper.js` (or in Unit 2.5 `src/enrich/search.js`), do not default to `html.duckduckgo.com`. Instead, use `https://duckduckgo.com/?q=${encodeURIComponent(query)}` with `waitUntil: 'networkidle2'`, where `puppeteer-extra-plugin-stealth` avoids the anomaly challenge and extracts 13–16 links consistently.

---

## 5. Verification Method

To independently reproduce this empirical finding, run the following command in the project root:

```bash
node -e '
const { createScraper } = require("./src/enrich/scraper.js");
(async () => {
  const scraper = await createScraper();
  console.log("Query 1: TESCO STORES LIMITED AL7 1GA");
  const r1 = await scraper.search("\"TESCO STORES LIMITED\" \"AL7 1GA\"");
  console.log("Q1 Status:", r1.statusCode, "Blocked:", r1.html.includes("anomaly-modal"), "Links:", r1.links.length);

  console.log("Query 2: BARCLAYS BANK PLC");
  const r2 = await scraper.search("\"BARCLAYS BANK PLC\"");
  console.log("Q2 Status:", r2.statusCode, "Blocked:", r2.html.includes("anomaly-modal"), "Links:", r2.links.length);

  await scraper.close();
})();
'
```

**Expected Invalidation Condition**:
If DuckDuckGo discontinues its anomaly challenge on `html.duckduckgo.com` or if `Q2 Blocked` outputs `false` with `Links > 0` and `Status: 200`, this challenge is invalidated.
