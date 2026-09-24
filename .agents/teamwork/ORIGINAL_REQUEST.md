# Original User Request

## Initial Request — 2026-09-24T06:59:30Z

# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview
> Requested team: [none — teamwork routes from the description]

Complete Phase 2 of the "Recent UK Companies" lead generation project strictly following `docs/working-style.md` and `docs/checklist.md` (creating PRs for each unit). This involves implementing the Companies House Officers API integration, setting up Puppeteer for web scraping, extracting social media URLs, and scraping contact details (emails and mobile numbers) to produce a final `leads.csv`.

Working directory: /home/nahid/Documents/Recent-uk-Companys
Integrity mode: development

## Requirements

### R1. Unit-by-Unit Git Workflow
The team must strictly follow `docs/working-style.md` and `docs/checklist.md`. For each unit (starting from Unit 2.3 up to Unit 2.7), the team must create a dedicated branch, commit the changes, and create a Pull Request.

### R2. Web Scraping for Contact Discovery
The team must implement the scraping logic using Puppeteer (or Playwright) to bypass API limits. It should search DuckDuckGo/Google for social media URLs, then visit those URLs to extract emails and WhatsApp/mobile numbers.

### R3. Output Generation
The final output must be appended to `leads.csv` with all the required columns formatted correctly (normalised phones, WhatsApp candidate flag, sources, etc.).

## Acceptance Criteria

### Workflow Compliance
- [ ] All code changes are submitted via individual Pull Requests for Units 2.3 to 2.7.
- [ ] The `docs/checklist.md` is updated and ticked for each completed unit.

### Pipeline Functionality
- [ ] Running the final pipeline manually (e.g. `npm run enrich`) on the candidates list successfully produces a `leads.csv`.
- [ ] The `leads.csv` contains valid extracted emails or mobile numbers for companies that do not have their own websites.
