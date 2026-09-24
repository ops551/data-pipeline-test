# BRIEFING — 2026-09-24T07:32:00Z

## Mission
Investigate and design technical strategies for Units 2.4, 2.5, 2.6: Web scraping tools (Puppeteer vs Playwright), DuckDuckGo/Google search strategies, own website vs directory detection, contact extraction (emails/UK phone numbers), and performance/concurrency/rate limiting.

## 🔒 My Identity
- Archetype: explorer
- Roles: investigation, synthesis
- Working directory: /home/nahid/Documents/Recent-uk-Companys/.agents/teamwork/teamwork_preview_explorer_survey_3
- Original parent: 0f79dc1f-898f-413d-869e-69d8d047848e
- Milestone: Phase 2 Technical Survey (Units 2.4, 2.5, 2.6)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Only write within /home/nahid/Documents/Recent-uk-Companys/.agents/teamwork/teamwork_preview_explorer_survey_3
- Do not create source code or tests in .agents/teamwork/
- Never name a file AGENTS.md or GEMINI.md

## Current Parent
- Conversation ID: 0f79dc1f-898f-413d-869e-69d8d047848e
- Updated: 2026-09-24T07:07:00Z

## Investigation State
- **Explored paths**:
  - Node.js environment: v24.18.0, Ubuntu 24.04 LTS, pre-installed Google Chrome 153.0.8010.47
  - Headless launch parameters: `--headless=new`, `--no-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`
  - DuckDuckGo HTML endpoint (`html.duckduckgo.com/html/`) & `uddg` redirect link decoding
  - Domain classification & directory domain taxonomy (preventing false drops from Companies House mirrors)
  - UK phone parsing: E.164 conversion, handling `+44 (0)7...` notation, identifying 071-079 mobiles vs 070/076/landlines
  - Email extraction regex & asset/spam filtering (`@2x.png`, `@5.1.3`, `noreply@`, `sentry.io`)
- **Key findings**:
  - `puppeteer-extra` + `puppeteer-extra-plugin-stealth` is recommended over Playwright due to mature anti-detection evasions and lighter footprint.
  - DuckDuckGo HTML provides static HTML without consent popups or aggressive reCAPTCHAs.
  - Outbound links in DDG require extracting and decoding `uddg` query parameter.
  - Domain classification engine is essential to distinguish Companies House mirrors (e.g. `opengovuk.com`, `find-and-update...`) and directories from true "own websites".
  - Phone normalisation must strip domestic `(0)` notation before removing non-digits to avoid length corruption.
- **Unexplored areas**: None for Units 2.4–2.6.

## Key Decisions Made
- Recommending `puppeteer-extra` with `puppeteer-extra-plugin-stealth`.
- DuckDuckGo HTML endpoint as primary search engine with randomized jitter (2.5–4.5s) and disk caching in `.cache/search/` and `.cache/pages/`.
- Strict phone normalisation to E.164 and marking `whatsapp_candidate = yes` only for `071`-`079` mobiles.

## Artifact Index
- DISPATCH.md — record of incoming dispatch instructions
- BRIEFING.md — situational awareness & persistent memory
- progress.md — liveness heartbeat
- report.md — comprehensive technical report for Units 2.4, 2.5, 2.6
- handoff.md — 5-component handoff report
