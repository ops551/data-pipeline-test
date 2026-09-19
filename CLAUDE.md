Create a CLAUDE.md file for this project.

Project purpose:
This project is ONLY for collecting recently incorporated UK companies from the official Companies House API and exporting the data to CSV.

Core workflow:
Companies House API → Fetch recent companies → Handle pagination → Remove duplicates → Export companies.csv

Rules for this project:

1. Use only the official Companies House API for company discovery.
2. Never hardcode API keys.
3. API credentials must come from .env:
   COMPANIES_HOUSE_API_KEY
4. Never commit .env or secrets to Git.
5. Keep the project focused only on Companies House company collection.
6. Do NOT add:
   - Google Maps
   - Google Search
   - Web scraping
   - Email scraping
   - Email discovery
   - WhatsApp discovery
   - Social media scraping
   - AI research
   - Contact enrichment
   - Lead scoring
7. These features may be added later as a separate Phase 2, but they must not be implemented now.
8. Use Node.js.
9. Keep the code simple, modular, readable, and beginner-friendly.
10. Use configurable date ranges and result limits.
11. Handle pagination correctly.
12. Prevent duplicate companies using company_number.
13. Handle API errors and rate limits gracefully.
14. Export collected companies to companies.csv.
15. Keep the CSV fields based on useful data actually returned by Companies House.
16. Do not invent API fields or endpoints.
17. Before changing the Companies House integration, verify the current official API documentation.
18. When modifying the project, preserve the existing folder structure unless there is a clear technical reason to change it.
19. Prefer small, focused changes instead of unnecessary rewrites.
20. When I ask for a code change, explain what files need to change before making unrelated changes.

Development behavior:

- First inspect the existing project structure and code.
- Reuse existing utilities when appropriate.
- Do not create duplicate functionality.
- Keep secrets out of source code.
- Keep the implementation production-safe but simple.
- If something is unclear, inspect the existing code/configuration before making assumptions.

The CLAUDE.md should be concise but detailed enough that Claude Code understands the project's purpose, architecture, rules, and current scope.
