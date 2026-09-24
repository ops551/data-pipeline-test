# Handoff Report: Units 2.4, 2.5, 2.6 Technical Strategy Survey

**Agent:** `teamwork_preview_explorer_survey_3`  
**Date:** 2026-09-24  
**Type:** Hard Handoff (Investigation & Technical Strategy Survey Complete)

---

## 1. Observation

1. **Host Environment & Browser Availability**:
   - Executed `node -v && uname -a && free -m`: Node.js is `v24.18.0`, running on Linux kernel `7.0.0-31-generic` (Ubuntu 24.04 LTS), x86_64, with 13,893 MB RAM (~6,939 MB available).
   - Executed `which google-chrome google-chrome-stable`: Google Chrome is pre-installed at `/usr/bin/google-chrome` and `/usr/bin/google-chrome-stable`.
   - Executed `google-chrome --version`: Returns `Google Chrome 153.0.8010.47`.
   - Executed `google-chrome --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --dump-dom "https://example.com"`: Chrome launched headlessly on Linux without error and dumped rendered DOM in 1.2s.

2. **Search Engine & Link Encoding Live Probing**:
   - Queried DuckDuckGo HTML endpoint `https://html.duckduckgo.com/html/?q=%22TESCO%20STORES%20LIMITED%22%20%22AL7%201GA%22`:
     - Returned HTTP 200 with 29,851 bytes of static HTML.
     - Outbound result links are wrapped in DuckDuckGo redirect format: `//duckduckgo.com/l/?uddg=<url_encoded_target>&rut=...`.
     - Decoding `decodeURIComponent(url.searchParams.get('uddg'))` cleanly unwraps the real destination URL (e.g. `https://find-and-update.company-information.service.gov.uk/company/00519500`).

3. **UK Telephone Normalisation & (0) Edge Case**:
   - Tested UK phone parsing with national and international notations:
     - `07123 456789` -> normalises to `+447123456789` (`type: mobile`, `whatsapp_candidate: yes`).
     - `020 7946 0192` -> normalises to `+442079460192` (`type: landline_geographic`, `whatsapp_candidate: no`).
     - `07012 345678` -> normalises to `+447012345678` (`type: personal_070`, `whatsapp_candidate: no`).
     - `07624 123456` -> normalises to `+447624123456` (`type: pager_076`, `whatsapp_candidate: no`).
     - `+44 (0)7123 456789`: If non-digits are stripped naively without removing `(0)`, the string corrupts to `+4407123456789` (invalid length 13). Removing `/\(\s*0\s*\)/g` first yields valid `+447123456789`.

4. **Email Extraction & Asset/Spam Filtering**:
   - Evaluated regex and filter against sample payload with mixed image filenames (`avatar@2x.png`, `user@2x.jpg`), npm dependencies (`bootstrap@5.1.3`), spam traps (`abuse@cloudflare.com`, `noreply@wixpress.com`), and valid contact emails (`info@smithbuilders.co.uk`, `john.doe@gmail.com`).
   - The multi-stage filter cleanly extracted valid emails and eliminated 100% of asset, dependency, and platform false positives.

5. **Existing Codebase & Project Docs**:
   - `docs/checklist.md` (lines 45–47): Unit 2.4 (Scraping Setup), Unit 2.5 (Search & Social Extraction), and Unit 2.6 (`leads.csv` & Phone Normalisation) are defined and marked `[ ]`.
   - `docs/path.md` (lines 88–146): Mandates dropping companies with their own website, extracting emails as primary target, extracting UK 07 mobiles as WhatsApp candidates, and outputting 20 specific columns to `leads.csv`.

---

## 2. Logic Chain

1. *From Observation 1*: The local system has Node.js 24 and Google Chrome 153 installed. Puppeteer can run headlessly using `--headless=new`, `--no-sandbox`, `--disable-dev-shm-usage`, and `--disable-gpu`.
2. *From Observation 1 and Existing Documentation*: `puppeteer-extra` combined with `puppeteer-extra-plugin-stealth` provides superior anti-detection and fingerprint masking compared to Playwright community ports, aligning with the project's requirements.
3. *From Observation 2*: DuckDuckGo HTML (`html.duckduckgo.com/html/`) does not suffer from Google's aggressive consent redirects or rapid reCAPTCHAs, and returns static HTML. However, search result links require unwrapping the `uddg` query parameter to extract the true destination URL.
4. *From Observation 2 and 5*: The search engine returns many Companies House mirror sites (`opengovuk.com`, `find-and-update...`, `bizdb.co.uk`, `companiesintheuk.co.uk`). Without a comprehensive domain classifier, these would be misclassified as the company's own website, triggering `has_website` and falsely dropping real leads. A robust domain classification engine (categorizing Gov/Mirrors, Social, Directories, Search Engines, and Own Websites) is essential.
5. *From Observation 3*: UK phone numbers must be normalised to E.164 (`+44...`). Only numbers beginning with `+447` where the national digit is not `0` (excluding 070 personal routing) and not `6` (excluding 076 pagers) qualify as `whatsapp_candidate = yes`. Domestic `(0)` notation must be stripped prior to punctuation removal to prevent length corruption.
6. *From Observation 4*: Email extraction from web pages requires strict filtering against graphic assets (`@2x.png`), software package versions (`@5.1.3`), and platform/webmaster addresses (`noreply@`, `abuse@`, `sentry.io`).

---

## 3. Caveats

- **Search Engine Blocking Under High Volume**: While DuckDuckGo HTML is significantly more resilient than Google, issuing rapid sequential requests (>1 request/second) from a single IP will still trigger rate limits. Delays of 2.5–4.5 seconds with jitter and disk caching are required.
- **Social Media Login Walls**: As specified in `docs/path.md`, social media pages (Facebook, Instagram, LinkedIn) must be fetched publicly without logging in. If a login wall or captcha is encountered, the scraper must gracefully skip rather than retry or block.

---

## 4. Conclusion

The technical strategy and architecture for Units 2.4, 2.5, and 2.6 are completely investigated, validated, and documented in:
`/home/nahid/Documents/Recent-uk-Companys/.agents/teamwork/teamwork_preview_explorer_survey_3/report.md`

Key recommendations:
- **Unit 2.4**: Use `puppeteer-extra` + `puppeteer-extra-plugin-stealth` with launch args `--headless=new`, `--no-sandbox`, `--disable-dev-shm-usage`, and request interception to block images/fonts/media.
- **Unit 2.5**: Primary search via DuckDuckGo HTML endpoint with query `"<Cleaned Name>" "<Postcode>"`, unwrapping `uddg` redirect parameters. Route all URLs through `domainClassifier.js` to ensure Companies House mirrors and directories are never misidentified as own websites.
- **Unit 2.6**: Normalise UK phones to `+44...`, filtering out `(0)` notation, and set `whatsapp_candidate = yes` only for `071`-`079` mobiles. Clean emails against asset extensions and spam traps. Append valid leads to `leads.csv` (20 columns).

---

## 5. Verification Method

1. **Verify Technical Strategy Report**:
   ```bash
   cat /home/nahid/Documents/Recent-uk-Companys/.agents/teamwork/teamwork_preview_explorer_survey_3/report.md
   ```
2. **Verify DuckDuckGo HTML & Link Unwrapping**:
   ```bash
   node -e 'fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent("\"TESCO\" \"AL7 1GA\""), { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" } }).then(r => r.text()).then(t => console.log("DDG HTML Length:", t.length, "Has uddg:", t.includes("uddg=")))'
   ```
3. **Verify Headless Chrome Launch on Host**:
   ```bash
   google-chrome --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --dump-dom "https://example.com" | grep -q "Example Domain" && echo "Chrome Headless Works"
   ```
