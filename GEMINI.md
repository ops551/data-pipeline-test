# Antigravity / Gemini Instructions for Recent UK Companies Project

## Project Purpose & Core Rules
1. ONLY use the official Companies House API for initial company discovery.
2. Web scraping (Puppeteer) is ALLOWED for Contact Discovery (Phase 2 & Phase 5) to bypass free API limits.
3. Keep the code simple, modular, readable, and beginner-friendly (Node.js 18+). No premature abstractions.
4. Never hardcode API keys or commit secrets (`.env`).
5. Always explain what files will be changed before making edits. Do not rewrite things unnecessarily.

## Phase 5 Active Goal: Decision-Maker Email Discovery
- The priority is finding emails for Founder, CEO, CTO, and other top-level decision-makers.
- **Strict Rule:** MUST NOT break the existing outreach workflow. If a personal email is found/inferred confidently, use it. If not, ALWAYS fallback to generic company emails (info@, sales@).
- Tracking logic must use `company_number + email` (not just `company_number`) so sending to one person doesn't exclude another. We will email ALL discovered top-level decision makers to maximize response rates.
- Do NOT use paid APIs (Apollo, Lusha, Hunter). Use public web searches, scraping, and smart email pattern detection (e.g. `first.last@domain`).

## Development & Working Style (Crucial!)
1. **Branch Workflow:** For every task, create a separate branch (`phase-<n>-unit-<n>`). Do the work -> Test -> Commit & Push -> `gh pr create` -> `gh pr merge` -> Delete branch. ONE UNIT AT A TIME.
2. **Testing Mindset:** Act as a Professional Tester. Think of edge cases. Intentionally introduce bugs to check if the logic handles them. Verify with `npm test` and real runs (`npm start` or real data). Never merge red code.
3. **Communication:** Short, concise answers in Banglish. Lead with the conclusion. Before coding, explain what you will do in Banglish. 
4. **Git Safety:** Never run destructive commands (like `reset --hard`) without asking. Always check `git status`.
