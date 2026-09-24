## 2026-09-24T07:05:08Z
Investigate and design technical strategies for Units 2.4, 2.5, 2.6:
- Web scraping tool options in Node.js (Puppeteer vs Playwright, stealth plugins like puppeteer-extra-plugin-stealth, headless browser launch arguments, sandboxing on Linux).
- Search strategy for company name + postcode on DuckDuckGo / Google: search query structure, bypassing blocks/rate limits, extracting target social media URLs (Facebook, Instagram, LinkedIn, directory listings like Yell, Bark, Checkatrade).
- Own website detection vs directory domains (how to identify if a domain is the company's own domain vs a directory/social platform).
- Contact extraction: regex and parsing logic for emails (excluding standard image/asset extensions, spam traps) and UK phone numbers (identifying 07 UK mobiles vs landlines).
- Performance, concurrency, rate limiting, and caching considerations so scraping is robust and doesn't get blocked.

Write findings and recommendations to /home/nahid/Documents/Recent-uk-Companys/.agents/teamwork/teamwork_preview_explorer_survey_3/report.md and handoff to /home/nahid/Documents/Recent-uk-Companys/.agents/teamwork/teamwork_preview_explorer_survey_3/handoff.md. Send completion message to parent orchestrator via send_message.
